import { z } from "zod";
import { safeUrl } from "./providers";
import { instructions } from "./prompt";
import type {
  Emit,
  MemoryStore,
  ModelClient,
  SearchClient,
  Source,
  Message,
} from "./types";

export const WEB_SEARCH = {
  type: "function",
  name: "web_search",
  description:
    "Search the public web with Firecrawl and retrieve page excerpts. Prefer specific queries for official pricing and release notes. Up to three independent queries run concurrently.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      queries: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 3,
      },
    },
    required: ["queries"],
    additionalProperties: false,
  },
};
const ToolArguments = z
  .object({ queries: z.array(z.string().trim().min(1).max(500)).min(1).max(3) })
  .strict();
const wantsHistory = (text: string) =>
  /\b(asked|ask you|remember|shortlisted|shortlist|we discussed|our choices|last (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(
    text,
  );
const wantsFresh = (text: string) =>
  /\b(today|current|currently|latest|recent|now|news|price|prices|pricing|changed|change|shipped|since|still correct|still accurate|up.to.date)\b/i.test(
    text,
  );
interface Options {
  memory: MemoryStore;
  model: ModelClient | null;
  search: SearchClient | null;
  mode: "demo" | "live";
  now?: () => Date;
}
export interface RunInput {
  conversationId: string;
  message: string;
  timezone: string;
  signal?: AbortSignal;
  emit?: Emit;
}
export interface RunResult {
  message: Message;
  metrics: { durationMs: number; searches: number };
}

export class Agent {
  private now: () => Date;
  constructor(private options: Options) {
    this.now = options.now ?? (() => new Date());
  }
  async run({
    conversationId,
    message,
    timezone,
    signal,
    emit = () => {},
  }: RunInput): Promise<RunResult> {
    const started = performance.now();
    const now = this.now();
    const { memory, model, search, mode } = this.options;
    signal?.throwIfAborted();
    const [recent, context] = await Promise.all([
      memory.messages(conversationId, 16),
      memory.retrieve(message, now, timezone),
    ]);
    await memory.addMessage(conversationId, "user", message, now.toISOString());
    const registry = new Map<string, Source>();
    let historicCount = 0;
    const remap = (text: string | null, sources: Source[]) => {
      const ids = new Map<string, string>();
      const mapped = sources
        .map((source) => {
          const url = safeUrl(source.url);
          if (!url) return null;
          const previous = [...registry.values()].find(
            (item) =>
              item.historical &&
              item.url === url &&
              item.retrievedAt === source.retrievedAt,
          );
          const id = previous?.id ?? `H${++historicCount}`;
          ids.set(source.id, id);
          const item = { ...source, id, url, historical: true };
          registry.set(id, item);
          return item;
        })
        .filter(
          (source): source is Source & { historical: boolean } =>
            source !== null,
        );
      return {
        text: text?.replace(/\[([SH]\d+)\]/g, (_, id: string) =>
          ids.has(id) ? `[${ids.get(id)}]` : "",
        ),
        sources: mapped,
      };
    };
    const excerpts = (sources: Source[]) =>
      sources.slice(0, 10).map((source) => ({
        ...source,
        content: source.content?.slice(0, 800),
      }));
    for (const item of context.memories) {
      const mapped = remap(item.answer, item.sources);
      item.answer = mapped.text ?? null;
      item.sources = excerpts(mapped.sources);
    }
    let recentSize = 0;
    const input: Record<string, unknown>[] = [];
    for (const row of [...recent].reverse()) {
      const mapped = remap(row.content, row.sources);
      const snapshots = excerpts(mapped.sources);
      const content = `[Sent ${row.createdAt}] ${(row.role === "user" ? row.content : (mapped.text ?? "")).slice(0, 5000)}${snapshots.length ? `\nHistorical sources (untrusted excerpts): ${JSON.stringify(snapshots)}` : ""}`;
      if (recentSize + content.length > 40_000) {
        context.truncated = true;
        break;
      }
      recentSize += content.length;
      input.unshift({ role: row.role, content });
    }
    let contextSize = 0;
    context.memories = context.memories.filter((item) => {
      const size = JSON.stringify(item).length;
      if (contextSize + size > 40_000) return false;
      contextSize += size;
      return true;
    });
    context.truncated ||= context.memories.length < context.total;
    emit("memory", {
      count: context.memories.length,
      dates: [...new Set(context.memories.map((item) => item.localDate))],
    });
    const fresh = wantsFresh(message);
    let answer = "";
    let searches = 0;
    let successful = 0;
    let failures = 0;
    if (wantsHistory(message) && context.date && !context.memories.length) {
      answer = `I have no saved conversation for ${context.date.day} (${timezone}). I can't reconstruct the question or answer reliably. Share the old question or shortlist and I can ${mode === "demo" ? "save it here. Live rechecking needs the API keys and Neon connection." : "compare it with current sources."}`;
    } else if (mode === "demo") {
      const previous = context.memories[0];
      answer = previous
        ? `**Offline demo** · I found a saved question from ${previous.localDate}:\n\n“${previous.question}”${previous.answer ? `\n\nThe saved answer was:\n\n${previous.answer}` : ""}\n\nI can't verify current information in demo mode. This temporary history resets when the server restarts.`
        : "**Offline demo** · Your question is saved with its timestamp in this temporary session. Live research and model answers require OPENAI_API_KEY, FIRECRAWL_API_KEY and a Neon DATABASE_URL. No external services were called.";
    } else {
      if (!model || !search)
        throw new Error("Live providers are not configured.");
      input.push({ role: "user", content: message });
      const seen = new Set<string>();
      let sourceCount = 0;
      for (let round = 0; round < 3; round++) {
        signal?.throwIfAborted();
        const tools = round < 2 && searches < 6 ? [WEB_SEARCH] : [];
        emit("status", {
          message: round ? "Comparing the evidence…" : "Reading your question…",
        });
        const response = await model.complete({
          input,
          instructions: instructions(now, timezone, context, fresh),
          tools,
          toolChoice: fresh && round === 0 ? "required" : "auto",
          signal,
          onDelta: (text) => emit("delta", { text }),
        });
        if (!response.toolCalls.length) {
          answer = response.text;
          break;
        }
        if (!tools.length)
          throw new Error("Model exceeded the research limit.");
        input.push(...response.output); // Includes opaque reasoning state, not exposed to the browser.
        for (const call of response.toolCalls) {
          let output: unknown;
          try {
            if (call.name !== "web_search")
              throw new Error("Only web_search is available.");
            const parsed = ToolArguments.parse(JSON.parse(call.arguments));
            const queries: string[] = [];
            for (const query of parsed.queries) {
              const key = query.toLowerCase();
              if (seen.has(key) || searches + queries.length >= 6) continue;
              seen.add(key);
              queries.push(query);
            }
            searches += queries.length;
            emit("status", {
              message: queries.length
                ? `Searching ${queries.length} ${queries.length === 1 ? "query" : "queries"} with Firecrawl…`
                : "Finishing from the available evidence…",
            });
            output = await Promise.all(
              queries.map(async (query) => {
                try {
                  const result = await search.search(query, { fresh, signal });
                  if (result.results.length) successful++;
                  return {
                    ...result,
                    results: result.results.map((source) => {
                      const previous = [...registry.values()].find(
                        (item) => !item.historical && item.url === source.url,
                      );
                      const id = previous?.id ?? `S${++sourceCount}`;
                      const item = {
                        ...source,
                        id,
                        retrievedAt: result.retrievedAt,
                      };
                      registry.set(id, item);
                      return item;
                    }),
                  };
                } catch {
                  signal?.throwIfAborted();
                  failures++;
                  return {
                    query,
                    error:
                      "Search failed. Do not claim this query was verified.",
                  };
                }
              }),
            );
            if (!queries.length)
              output = {
                error:
                  "No new queries remain. Give an answer from evidence and state gaps.",
              };
          } catch {
            signal?.throwIfAborted();
            output = {
              error:
                "Invalid tool request. Only web_search with 1–3 nonempty queries of at most 500 characters is allowed.",
            };
          }
          input.push({
            type: "function_call_output",
            call_id: call.callId,
            output: JSON.stringify(output),
          });
        }
      }
      if (!answer.trim())
        throw new Error("Model returned no final answer. Please try again.");
      if (fresh && !successful)
        answer +=
          "\n\nI could not verify current information from web sources for this request.";
      else if (failures)
        answer += `\n\n${failures} search ${failures === 1 ? "query failed" : "queries failed"}, so this comparison may be incomplete.`;
    }
    signal?.throwIfAborted();
    const cited = new Set<string>();
    answer = answer.replace(/\[([SH]\d+)\]/g, (match, id: string) => {
      if (!registry.has(id)) return "[unverified source]";
      cited.add(id);
      return match;
    });
    const metrics = {
      durationMs: Math.round(performance.now() - started),
      searches,
    };
    const saved = await memory.addMessage(
      conversationId,
      "assistant",
      answer,
      this.now().toISOString(),
      [...cited].map((id) => registry.get(id)!),
      {
        ...metrics,
        memoryCount: context.memories.length,
        memoryDates: [
          ...new Set(context.memories.map((item) => item.localDate)),
        ],
        timezone,
        mode,
      },
    );
    const result = { message: saved, metrics };
    emit("done", result);
    return result;
  }
}
