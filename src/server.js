import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { Memory } from "./memory.js";
import { Agent } from "./agent.js";
import { ModelProvider, SearchProvider } from "./providers.js";
import { loadConfig } from "./config.js";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);
const fail = (status, message) => Object.assign(new Error(message), { status });
function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw fail(415, "Use application/json.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20_000) throw fail(413, "Request is too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error();
    return value;
  } catch {
    throw fail(400, "Invalid JSON object.");
  }
}

export function createApp({ memory, agent, config }) {
  const busy = new Set();
  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    response.setHeader("Cache-Control", "no-store");
    try {
      const port = server.address()?.port;
      const host = request.headers.host;
      if (
        ![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(
          host,
        )
      )
        throw fail(403, "Only loopback hosts are allowed.");
      const origin = request.headers.origin;
      if (
        (origin && origin !== `http://${host}`) ||
        request.headers["sec-fetch-site"] === "cross-site"
      )
        throw fail(403, "Cross-origin requests are not allowed.");
      const url = new URL(request.url, `http://${host}`);
      if (request.method === "GET" && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        response.writeHead(200, { "Content-Type": type });
        response.end(await readFile(join(root, file)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/status")
        return json(response, 200, {
          mode: config.mode,
          model: config.mode === "demo" ? "Offline demo" : config.model,
          timezone: config.timezone,
          configured: config.mode === "live",
        });
      if (request.method === "GET" && url.pathname === "/api/conversations")
        return json(response, 200, memory.conversations());
      if (request.method === "POST" && url.pathname === "/api/conversations") {
        await readJson(request);
        return json(response, 201, memory.createConversation());
      }
      const match = url.pathname.match(
        /^\/api\/conversations\/([a-zA-Z0-9-]+)$/,
      );
      if (request.method === "GET" && match) {
        const conversation = memory.conversation(match[1]);
        if (!conversation) throw fail(404, "Conversation not found.");
        return json(response, 200, {
          conversation,
          messages: memory.messages(conversation.id),
        });
      }
      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(request);
        const { conversationId } = body;
        const message =
          typeof body.message === "string" ? body.message.trim() : null;
        const timezone = body.timezone || config.timezone;
        if (
          typeof conversationId !== "string" ||
          typeof message !== "string" ||
          !message ||
          message.length > 4000
        )
          throw fail(
            400,
            "Choose a conversation and send a message of 1–4000 characters.",
          );
        try {
          if (typeof timezone !== "string") throw new Error();
          new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
        } catch {
          throw fail(400, "Invalid IANA timezone.");
        }
        if (!memory.conversation(conversationId))
          throw fail(404, "Conversation not found.");
        if (busy.has(conversationId))
          throw fail(
            409,
            "A response is already running in this conversation.",
          );
        if (busy.size >= 3)
          throw fail(429, "Too many active responses. Please wait.");
        busy.add(conversationId);
        const abort = new AbortController();
        const signal = AbortSignal.any([
          abort.signal,
          AbortSignal.timeout(90_000),
        ]);
        response.on("close", () => abort.abort());
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.flushHeaders();
        const emit = (event, data) => {
          if (!response.destroyed && !response.writableEnded)
            response.write(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            );
        };
        emit("status", { message: "Retrieving conversation context…" });
        const heartbeat = setInterval(() => {
          if (!response.destroyed) response.write(": keepalive\n\n");
        }, 10_000);
        try {
          await agent.run({ conversationId, message, timezone, signal, emit });
        } catch (error) {
          const message = signal.aborted
            ? "The response was stopped or reached its time limit. Your question is saved."
            : error.message;
          emit("error", { message });
        } finally {
          clearInterval(heartbeat);
          busy.delete(conversationId);
          response.end();
        }
        return;
      }
      throw fail(404, "Not found.");
    } catch (error) {
      if (!response.headersSent)
        json(response, error.status || 500, {
          error: error.status
            ? error.message
            : "The server could not complete this request.",
        });
      else response.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const config = loadConfig();
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    const memory = new Memory(
      join(
        config.dataDir,
        config.mode === "demo" ? "demo.sqlite" : "recall.sqlite",
      ),
    );
    const model =
      config.mode === "live"
        ? new ModelProvider({
            apiKey: config.apiKey,
            model: config.model,
            baseUrl: config.baseUrl,
          })
        : null;
    const search =
      config.mode === "live"
        ? new SearchProvider({ apiKey: config.searchKey })
        : null;
    const agent = new Agent({ memory, model, search, mode: config.mode });
    const server = createApp({ memory, agent, config });
    server.on("error", (error) => {
      console.error(`Unable to start Recall: ${error.code || "server error"}`);
      memory.close();
      process.exitCode = 1;
    });
    server.listen(config.port, "127.0.0.1", () =>
      console.log(
        `Recall • ${config.mode === "demo" ? "OFFLINE DEMO (no live model or search)" : "live"}\nhttp://localhost:${config.port}\nPress Ctrl+C to stop.`,
      ),
    );
    for (const event of ["SIGINT", "SIGTERM"])
      process.once(event, () => {
        server.closeAllConnections();
        server.close(() => {
          memory.close();
          process.exit(0);
        });
      });
  } catch (error) {
    console.error(`Unable to start Recall: ${error.message}`);
    process.exitCode = 1;
  }
}
