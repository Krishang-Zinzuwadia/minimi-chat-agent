import OpenAI from "openai";
import type {
  ResponseCreateParamsStreaming,
  ResponseInput,
  Tool,
} from "openai/resources/responses/responses";
import type {
  ModelClient,
  ModelRequest,
  ModelResult,
  SearchClient,
  SearchResult,
} from "./types";

export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length < 2000
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Official SDK handles SSE framing; keep opaque reasoning items for stateless tool continuation. */
export class ResponsesModel implements ModelClient {
  private client: OpenAI;
  private model: string;
  private publicMode: boolean;
  private beforeRequest?: () => Promise<void>;
  constructor({
    apiKey,
    model = "gpt-6-luna",
    baseUrl = "https://api.openai.com/v1",
    fetchImpl = fetch,
    publicMode = false,
    beforeRequest,
  }: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    publicMode?: boolean;
    beforeRequest?: () => Promise<void>;
  }) {
    this.model = "gpt-6-luna";
    this.publicMode = publicMode;
    this.beforeRequest = beforeRequest;
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      fetch: fetchImpl,
      maxRetries: publicMode ? 0 : 1,
      timeout: 45_000,
    });
  }
  async complete({
    input,
    instructions,
    tools,
    toolChoice = "auto",
    signal,
    onDelta = () => {},
  }: ModelRequest): Promise<ModelResult> {
    const deadline = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(45_000),
    ]);
    if (
      this.publicMode &&
      JSON.stringify({ input, instructions, tools }).length > 48_000
    )
      throw new Error("Model context is too large. Start a new conversation.");
    await this.beforeRequest?.();
    let text = "";
    try {
      const request: ResponseCreateParamsStreaming = {
        model: this.model,
        instructions,
        input: input as unknown as ResponseInput,
        tools: tools as unknown as Tool[],
        tool_choice: tools.length ? toolChoice : "none",
        reasoning: { effort: "low" },
        include: ["reasoning.encrypted_content"],
        store: false,
        stream: true,
        max_output_tokens: this.publicMode ? 1500 : 6000,
      };
      const stream = await this.client.responses.create(request, {
        signal: deadline,
      });
      let output: Record<string, unknown>[] | null = null;
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          text += event.delta;
          if (text.length > 40_000)
            throw new Error("Model answer exceeded the response limit.");
          onDelta(event.delta);
        }
        if (event.type === "response.completed")
          output = event.response.output as unknown as Record<
            string,
            unknown
          >[];
        if (event.type === "response.incomplete")
          throw new Error(
            "Model response was incomplete. Try a narrower question.",
          );
        if (event.type === "response.failed" || event.type === "error")
          throw new Error("Model could not complete this response.");
      }
      if (!output)
        throw new Error("Model stream ended without a completed response.");
      const toolCalls = output
        .filter((item) => item.type === "function_call")
        .map((item) => {
          if (
            typeof item.id !== "string" ||
            typeof item.call_id !== "string" ||
            typeof item.name !== "string" ||
            typeof item.arguments !== "string" ||
            item.arguments.length > 10_000
          )
            throw new Error("Model returned an invalid tool call.");
          return {
            id: item.id,
            callId: item.call_id,
            name: item.name,
            arguments: item.arguments,
          };
        });
      if (toolCalls.length > 6)
        throw new Error("Model exceeded the tool-call limit.");
      return { text, toolCalls, output };
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof OpenAI.APIError)
        throw new Error(
          `Model request failed (HTTP ${error.status ?? "unknown"}). Check access, quota and provider status.`,
        );
      if (deadline.aborted)
        throw new Error("The model response timed out. Please try again.");
      if (error instanceof Error && error.message.startsWith("Model "))
        throw error;
      throw new Error("Model connection failed. Please try again.");
    }
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Search returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000)
        throw new Error("Search response exceeded the safety limit.");
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return JSON.parse(result);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Search + page excerpts are one tool and one provider request, never arbitrary URL fetching. */
export class FirecrawlSearch implements SearchClient {
  private cache = new Map<string, SearchResult>();
  constructor(
    private options: {
      apiKey: string;
      fetchImpl?: typeof fetch;
      now?: () => Date;
      beforeRequest?: () => Promise<void>;
    },
  ) {}
  async search(
    query: string,
    { fresh = false, signal }: { fresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<SearchResult> {
    if (typeof query !== "string" || !query.trim() || query.length > 500)
      throw new Error("Search query must contain 1–500 characters.");
    query = query.trim();
    const key = query.toLowerCase();
    const now = this.options.now ?? (() => new Date());
    const cached = this.cache.get(key);
    if (!fresh && cached && +now() - Date.parse(cached.retrievedAt) < 300_000)
      return { ...cached, cached: true };
    const deadline = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(25_000),
    ]);
    await this.options.beforeRequest?.();
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(
        "https://api.firecrawl.dev/v2/search",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: deadline,
          body: JSON.stringify({
            query,
            limit: 4,
            sources: [{ type: "web" }],
            domainTools: false,
            safe: true,
            timeout: 20_000,
            ignoreInvalidURLs: true,
            scrapeOptions: {
              formats: [{ type: "markdown" }],
              onlyMainContent: true,
              maxAge: fresh ? 0 : 300_000,
            },
          }),
        },
      );
    } catch {
      signal?.throwIfAborted();
      throw new Error("Search connection failed or timed out.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Search request failed (HTTP ${response.status}). Check access, quota and provider status.`,
      );
    }
    let raw: unknown;
    try {
      raw = await boundedJson(response);
    } catch {
      signal?.throwIfAborted();
      throw new Error("Search returned an invalid or oversized response.");
    }
    const body = raw as {
      success?: boolean;
      data?: { web?: Record<string, unknown>[] };
    };
    if (!body || body.success !== true || !Array.isArray(body.data?.web))
      throw new Error("Search provider returned an invalid response.");
    const value: SearchResult = {
      query,
      retrievedAt: now().toISOString(),
      cached: false,
      results: body.data.web.slice(0, 4).flatMap((row) => {
        const url = safeUrl(row.url);
        if (!url) return [];
        const metadata = row.metadata as Record<string, unknown> | undefined;
        if (
          metadata?.error ||
          (typeof metadata?.statusCode === "number" &&
            metadata.statusCode >= 400)
        )
          return [];
        return [
          {
            url,
            title: String(row.title || metadata?.title || url).slice(0, 200),
            content: String(row.markdown || row.description || "").slice(
              0,
              6000,
            ),
            publishedAt:
              typeof metadata?.publishedTime === "string"
                ? metadata.publishedTime
                : null,
          },
        ];
      }),
    };
    if (this.cache.size >= 100)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, value);
    return value;
  }
}
