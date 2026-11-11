import { z } from "zod";
import { loadConfig, publicStatus, type Config } from "./config";
import { authorize } from "./auth";
import { AppError } from "./errors";
import { NeonMemory } from "./memory";
import { getDemoMemory } from "./demo-memory";
import { Agent, type RunInput } from "./agent";
import { ResponsesModel, FirecrawlSearch } from "./providers";
import type { MemoryStore, Emit } from "./types";
import { buildSuggestions } from "./suggestions";

const ChatBody = z
  .object({
    conversationId: z.string().uuid(),
    message: z.string().trim().min(1).max(4000),
    timezone: z.string().min(1).max(80).default("UTC"),
  })
  .strict();
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError(415, "Use application/json.");
  if (Number(request.headers.get("content-length")) > 20_000)
    throw new AppError(413, "The request is too large.");
  if (!request.body) throw new AppError(400, "A JSON body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 20_000) throw new AppError(413, "The request is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new AppError(400, "Invalid JSON body.");
  }
}
interface Dependencies {
  config?: () => Config;
  memory?: (config: Config, owner: string) => MemoryStore;
  agent?: (
    memory: MemoryStore,
    config: Config,
  ) => { run: (input: RunInput) => Promise<unknown> };
}
export function createApi(deps: Dependencies = {}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const config = (deps.config ?? loadConfig)();
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/api/status")
        return json(publicStatus(config, request));
      const owner = await authorize(request, config);
      if (config.mode === "setup")
        throw new AppError(
          503,
          "Server setup is incomplete. Configure the required server-side settings.",
        );
      const memory =
        deps.memory?.(config, owner) ??
        (config.mode === "live"
          ? new NeonMemory(config.databaseUrl, owner)
          : getDemoMemory(owner));
      if (path === "/api/suggestions") {
        if (request.method !== "GET")
          throw new AppError(405, "Method not allowed.");
        return json(buildSuggestions(await memory.recentQuestions()));
      }
      if (path === "/api/conversations") {
        if (request.method === "GET") return json(await memory.conversations());
        if (request.method === "POST") {
          const body = await readBody(request);
          if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            Object.keys(body).length
          )
            throw new AppError(400, "Expected an empty JSON object.");
          return json(await memory.createConversation(), 201);
        }
        throw new AppError(405, "Method not allowed.");
      }
      const match = path.match(/^\/api\/conversations\/([a-zA-Z0-9-]+)$/);
      if (match && request.method === "GET") {
        if (!z.string().uuid().safeParse(match[1]).success)
          throw new AppError(404, "Conversation not found.");
        const conversation = await memory.conversation(match[1]);
        if (!conversation) throw new AppError(404, "Conversation not found.");
        return json({
          conversation,
          messages: await memory.messages(conversation.id),
        });
      }
      if (path === "/api/chat" && request.method === "POST") {
        const parsed = ChatBody.safeParse(await readBody(request));
        if (!parsed.success)
          throw new AppError(
            400,
            "Choose a conversation and send a message of 1–4000 characters.",
          );
        const { conversationId, message, timezone } = parsed.data;
        try {
          new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
        } catch {
          throw new AppError(400, "Invalid IANA timezone.");
        }
        if (!(await memory.conversation(conversationId)))
          throw new AppError(404, "Conversation not found.");
        const lease = crypto.randomUUID();
        if (
          !(await memory.acquireLease(
            conversationId,
            lease,
            new Date(Date.now() + 120_000).toISOString(),
          ))
        )
          throw new AppError(
            429,
            "Another response is running for this account, or the 60-turn daily limit has been reached. Wait for the response to finish or try again after UTC midnight.",
          );
        const agent =
          deps.agent?.(memory, config) ??
          new Agent({
            memory,
            mode: config.mode,
            model:
              config.mode === "live"
                ? new ResponsesModel({
                    apiKey: config.apiKey,
                    model: config.model,
                    baseUrl: config.baseUrl,
                  })
                : null,
            search:
              config.mode === "live"
                ? new FirecrawlSearch({ apiKey: config.firecrawlKey })
                : null,
          });
        const abort = new AbortController();
        const signal = AbortSignal.any([
          abort.signal,
          request.signal,
          AbortSignal.timeout(90_000),
        ]);
        const encoder = new TextEncoder();
        let closed = false;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit: Emit = (event, data) => {
              if (!closed)
                try {
                  controller.enqueue(
                    encoder.encode(
                      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                    ),
                  );
                } catch {
                  closed = true;
                  abort.abort();
                }
            };
            const heartbeat = setInterval(() => {
              if (!closed)
                try {
                  controller.enqueue(encoder.encode(": keepalive\n\n"));
                } catch {
                  abort.abort();
                }
            }, 10_000);
            void (async () => {
              try {
                emit("status", { message: "Retrieving the conversation…" });
                await agent.run({
                  conversationId,
                  message,
                  timezone,
                  signal,
                  emit,
                });
              } catch (error) {
                emit("error", {
                  message: signal.aborted
                    ? "The response was stopped or timed out. Your question may already be saved."
                    : error instanceof Error &&
                        /^(Model |Search |Live providers)/.test(error.message)
                      ? error.message
                      : "The response could not be completed. Please try again.",
                });
              } finally {
                clearInterval(heartbeat);
                try {
                  await memory.releaseLease(conversationId, lease);
                } catch {
                  /* Lease expires automatically if the database is temporarily unavailable. */
                }
                if (!closed) {
                  closed = true;
                  controller.close();
                }
              }
            })();
          },
          cancel() {
            closed = true;
            abort.abort();
          },
        });
        return new Response(body, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      throw new AppError(404, "Not found.");
    } catch (error) {
      return json(
        {
          error:
            error instanceof AppError
              ? error.message
              : "The server could not complete this request.",
        },
        error instanceof AppError ? error.status : 500,
      );
    }
  };
}
