import test from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../lib/agent";
import { DemoMemory } from "../lib/demo-memory";
import type { ModelClient, ModelResult, SearchClient } from "../lib/types";
const answer = (text: string): ModelResult => ({
  text,
  toolCalls: [],
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  ],
});
const call = (queries: string[], name = "web_search"): ModelResult => ({
  text: "",
  toolCalls: [
    {
      id: "fc1",
      callId: "call1",
      name,
      arguments: JSON.stringify({ queries }),
    },
  ],
  output: [
    { type: "reasoning", id: "rs1", encrypted_content: "opaque", summary: [] },
    {
      type: "function_call",
      id: "fc1",
      call_id: "call1",
      name,
      arguments: JSON.stringify({ queries }),
    },
  ],
});
async function setup(
  model: ModelClient | null,
  search: SearchClient | null,
  mode: "demo" | "live" = "live",
) {
  const memory = new DemoMemory();
  const c = await memory.createConversation();
  return {
    memory,
    id: c.id,
    agent: new Agent({
      memory,
      model,
      search: search ?? {
        search: async () => {
          throw new Error("Unexpected search");
        },
      },
      mode,
      now: () => new Date("2026-11-11T12:00:00Z"),
    }),
  };
}
test("fresh recheck uses Responses reasoning continuation and citation registry", async () => {
  let rounds = 0,
    wasFresh = false;
  const model: ModelClient = {
    complete: async (request) => {
      rounds++;
      if (rounds === 1) {
        assert.equal(request.toolChoice, "required");
        return call(["Neon pricing"]);
      }
      assert.ok(request.input.some((item) => item.type === "reasoning"));
      assert.ok(
        request.input.some(
          (item) =>
            item.type === "function_call_output" && item.call_id === "call1",
        ),
      );
      return answer("Current price [S1]. Invalid claim [S99].");
    },
  };
  const search: SearchClient = {
    search: async (q, options) => {
      wasFresh = Boolean(options?.fresh);
      return {
        query: q,
        retrievedAt: "2026-11-11T12:00:00Z",
        cached: false,
        results: [
          { url: "https://neon.com/pricing", title: "Neon", content: "$20" },
        ],
      };
    },
  };
  const { agent, id, memory } = await setup(model, search);
  const result = await agent.run({
    conversationId: id,
    message: "What is current Neon pricing?",
    timezone: "UTC",
  });
  assert.equal(wasFresh, true);
  assert.match(result.message.content, /unverified source/);
  assert.equal(result.message.sources.length, 1);
  assert.equal((await memory.messages(id)).length, 2);
});
test("dated recall keeps historical snapshots separate from new source IDs", async () => {
  let round = 0;
  const model: ModelClient = {
    complete: async (request) => {
      assert.match(request.instructions, /Historical price was \$19/);
      return ++round === 1
        ? call(["Neon today"])
        : answer("Then $19 [H1]; now $20 [S1].");
    },
  };
  const { agent, id, memory } = await setup(model, {
    search: async (q) => ({
      query: q,
      retrievedAt: "2026-11-11T12:00:00Z",
      cached: false,
      results: [
        { title: "Neon", url: "https://neon.com/pricing", content: "$20" },
      ],
    }),
  });
  await memory.addMessage(
    id,
    "user",
    "Postgres hosting",
    "2026-11-03T09:00:00Z",
  );
  await memory.addMessage(
    id,
    "assistant",
    "Historical price was $19 [S1]",
    "2026-11-03T09:00:01Z",
    [
      {
        id: "S1",
        title: "Neon",
        url: "https://neon.com/pricing",
        retrievedAt: "2026-11-03T09:00:01Z",
      },
    ],
  );
  const result = await agent.run({
    conversationId: id,
    message: "On 3 November I asked about Postgres. Has pricing changed?",
    timezone: "UTC",
  });
  assert.deepEqual(
    result.message.sources.map((s) => s.id),
    ["H1", "S1"],
  );
});
test("missing dated history makes no model call; demo never pretends to be live", async () => {
  const { agent, id } = await setup(
    {
      complete: async () => {
        throw new Error("must not call");
      },
    },
    null,
  );
  assert.match(
    (
      await agent.run({
        conversationId: id,
        message: "What did I ask you on 3 November?",
        timezone: "UTC",
      })
    ).message.content,
    /no saved conversation/i,
  );
  const demo = await setup(null, null, "demo");
  assert.match(
    (
      await demo.agent.run({
        conversationId: demo.id,
        message: "Latest news?",
        timezone: "UTC",
      })
    ).message.content,
    /offline demo/i,
  );
});
test("recent source follow-up carries provenance without lexical match", async () => {
  const { agent, id, memory } = await setup(
    {
      complete: async (request) => {
        const text = JSON.stringify(request.input);
        assert.match(text, /https:\/\/neon.com\/pricing/);
        assert.match(text, /\[H1\]/);
        return answer("Here [H1].");
      },
    },
    null,
  );
  await memory.addMessage(
    id,
    "user",
    "Explain the offer",
    "2026-11-09T00:00:00Z",
  );
  await memory.addMessage(
    id,
    "assistant",
    "It is $19 [S1]",
    "2026-11-09T00:00:01Z",
    [
      {
        id: "S1",
        title: "Neon",
        url: "https://neon.com/pricing",
        retrievedAt: "2026-11-09T00:00:01Z",
      },
    ],
  );
  const result = await agent.run({
    conversationId: id,
    message: "Can you link the source?",
    timezone: "UTC",
  });
  assert.equal(result.message.sources[0].historical, true);
});
test("query budget terminates repeated tool calls and search failures remain explicit", async () => {
  let round = 0,
    queries = 0;
  const { agent, id } = await setup(
    {
      complete: async (request) => {
        round++;
        return request.tools.length
          ? call(["a", "b", "c"])
          : answer("Could not establish a change.");
      },
    },
    {
      search: async () => {
        queries++;
        throw new Error("offline");
      },
    },
  );
  const result = await agent.run({
    conversationId: id,
    message: "Has pricing changed?",
    timezone: "UTC",
  });
  assert.ok(round <= 3);
  assert.ok(queries <= 6);
  assert.match(result.message.content, /could not verify/i);
});
test("cancellation does not save an assistant answer", async () => {
  const abort = new AbortController();
  const { agent, id, memory } = await setup(
    {
      complete: async () => {
        abort.abort();
        return answer("Incomplete");
      },
    },
    null,
  );
  await assert.rejects(() =>
    agent.run({
      conversationId: id,
      message: "Hello",
      timezone: "UTC",
      signal: abort.signal,
    }),
  );
  assert.deepEqual(
    (await memory.messages(id)).map((m) => m.role),
    ["user"],
  );
});
test("duplicate queries within one tool batch are charged and searched only once", async () => {
  let queries = 0;
  let round = 0;
  const { agent, id } = await setup(
    {
      complete: async () =>
        ++round === 1
          ? call(["Neon pricing", "neon pricing", "Neon pricing"])
          : answer("No data available."),
    },
    {
      search: async (q) => {
        queries++;
        return {
          query: q,
          retrievedAt: new Date().toISOString(),
          cached: false,
          results: [],
        };
      },
    },
  );
  const result = await agent.run({
    conversationId: id,
    message: "Neon pricing now",
    timezone: "UTC",
  });
  assert.equal(queries, 1);
  assert.equal(result.metrics.searches, 1);
});
