import { setTimeout as delay } from "node:timers/promises";

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length <= 2000
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function request(fetchImpl, url, init, label) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl(url, init);
    if (response.ok) return response;
    await response.body?.cancel();
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await delay(250, undefined, { signal: init.signal });
      continue;
    }
    throw new Error(
      `${label} request failed (HTTP ${response.status}). Check API credentials, quota, and provider status.`,
    );
  }
}

/** Parse SSE by records, not TCP chunks. TextDecoder keeps split UTF-8 intact. */
async function* events(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length > 2_000_000)
        throw new Error("Model response exceeded the safety limit.");
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data === "[DONE]") return;
        if (data) yield JSON.parse(data);
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class ModelProvider {
  constructor({
    apiKey,
    model = "gpt-4.1-mini",
    baseUrl = "https://api.openai.com/v1",
    fetchImpl = fetch,
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    this.fetch = fetchImpl;
  }
  async complete({
    messages,
    tools = [],
    toolChoice = "auto",
    signal,
    onDelta = () => {},
  }) {
    const deadline = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(45_000),
    ]);
    const response = await request(
      this.fetch,
      this.url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: deadline,
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          max_completion_tokens: 2500,
          ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
        }),
      },
      "Model",
    );
    let content = "",
      finish = null;
    const calls = new Map();
    for await (const event of events(response)) {
      if (event.error)
        throw new Error("Model provider returned a streaming error.");
      const choice = event.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (typeof delta.content === "string") {
        content += delta.content;
        onDelta(delta.content);
      }
      for (const part of delta.tool_calls || []) {
        if (!Number.isInteger(part.index) || part.index < 0 || part.index > 5)
          throw new Error("Invalid model tool call index.");
        const call = calls.get(part.index) || {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        };
        if (part.id) call.id += part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments)
          call.function.arguments += part.function.arguments;
        if (call.function.arguments.length > 10_000)
          throw new Error("Model tool arguments exceeded the safety limit.");
        calls.set(part.index, call);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
      if (content.length > 40_000)
        throw new Error("Model response exceeded the safety limit.");
    }
    if (finish === "length")
      throw new Error(
        "Model response was truncated. Please narrow the question.",
      );
    if (!["stop", "tool_calls"].includes(finish))
      throw new Error("Model stream ended without a complete answer.");
    const tool_calls = [...calls.values()];
    if (tool_calls.some((c) => !c.id || !c.function.name))
      throw new Error("Incomplete model tool call.");
    return {
      role: "assistant",
      content: content || null,
      ...(tool_calls.length ? { tool_calls } : {}),
    };
  }
}

export class SearchProvider {
  constructor({ apiKey, fetchImpl = fetch, now = () => new Date() }) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.now = now;
    this.cache = new Map();
  }
  async search(query, { fresh = false, signal } = {}) {
    if (typeof query !== "string" || !query.trim() || query.length > 500)
      throw new Error("Search query must contain 1–500 characters.");
    query = query.trim();
    const key = query.toLowerCase();
    const cached = this.cache.get(key);
    if (
      !fresh &&
      cached &&
      +this.now() - Date.parse(cached.retrievedAt) < 300_000
    )
      return { ...cached, cached: true };
    const deadline = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(15_000),
    ]);
    const response = await request(
      this.fetch,
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: deadline,
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: 5,
          include_answer: false,
          include_raw_content: false,
          include_published_date: true,
          topic: "general",
          ...(fresh ? { max_age_hours: 0 } : {}),
        }),
      },
      "Search",
    );
    const body = await response.text();
    if (body.length > 2_000_000)
      throw new Error("Search response exceeded the safety limit.");
    const data = JSON.parse(body);
    if (!Array.isArray(data.results))
      throw new Error("Search provider returned an invalid response.");
    const results = data.results.slice(0, 5).flatMap((result) => {
      const url = safeUrl(result.url);
      if (!url) return [];
      return [
        {
          title: String(result.title || url).slice(0, 200),
          url,
          content: String(result.content || "").slice(0, 2400),
          publishedAt:
            typeof result.published_date === "string"
              ? result.published_date
              : null,
        },
      ];
    });
    const value = {
      query,
      retrievedAt: this.now().toISOString(),
      cached: false,
      results,
    };
    if (this.cache.size >= 100)
      this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, value);
    return value;
  }
}
