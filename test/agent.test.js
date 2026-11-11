import test from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/agent.js";
import { Memory } from "../src/memory.js";
const tool = (queries, name = "web_search") => ({
  role: "assistant",
  content: null,
  tool_calls: [
    {
      id: "call-1",
      type: "function",
      function: { name, arguments: JSON.stringify({ queries }) },
    },
  ],
});
const answer = (content) => ({ role: "assistant", content });
function setup(t, model, search, mode = "live") {
  const memory = new Memory(":memory:");
  t.after(() => memory.close());
  const c = memory.createConversation();
  const agent = new Agent({
    memory,
    model,
    search,
    mode,
    now: () => new Date("2026-11-11T12:00:00Z"),
  });
  return { agent, memory, id: c.id };
}
test("freshness requests force web search, retain provenance and reject fabricated citations", async (t) => {
  let calls = 0,
    fresh = false;
  const model = {
    complete: async (options) => {
      calls++;
      if (calls === 1) {
        assert.equal(options.toolChoice, "required");
        return tool(["Neon current pricing"]);
      }
      return answer("Neon is $20 [S1]. Other claim [S99].");
    },
  };
  const search = {
    search: async (q, o) => {
      fresh = o.fresh;
      return {
        query: q,
        retrievedAt: "2026-11-11T12:00:00Z",
        results: [
          { url: "https://neon.com/pricing", title: "Neon", content: "$20" },
        ],
      };
    },
  };
  const { agent, memory, id } = setup(t, model, search);
  const events = [];
  const result = await agent.run({
    conversationId: id,
    message: "What is current Neon pricing?",
    timezone: "UTC",
    emit: (e, d) => events.push([e, d]),
  });
  assert.equal(fresh, true);
  assert.equal(result.message.sources.length, 1);
  assert.match(result.message.content, /unverified source/);
  assert.equal(memory.messages(id).length, 2);
  assert.equal(events.at(-1)[0], "done");
});
test("dated recall retrieves original answer and fresh comparison uses both snapshots", async (t) => {
  let calls = 0;
  const model = {
    complete: async (options) => {
      calls++;
      const context = options.messages.map((m) => m.content).join("\n");
      assert.match(context, /Historical price was \$19/);
      assert.match(context, /2026-11-03/);
      return calls === 1
        ? tool(["Neon pricing today"])
        : answer("Then $19 [H1]; now $20 [S1].");
    },
  };
  const search = {
    search: async () => ({
      retrievedAt: "2026-11-11T12:00:00Z",
      results: [
        { url: "https://neon.com/pricing", title: "Neon", content: "$20" },
      ],
    }),
  };
  const { agent, memory, id } = setup(t, model, search);
  memory.addMessage(
    id,
    "user",
    "Postgres hosting options",
    "2026-11-03T10:00:00Z",
  );
  memory.addMessage(
    id,
    "assistant",
    "Historical price was $19 [S1]",
    "2026-11-03T10:00:01Z",
    [
      {
        id: "S1",
        url: "https://neon.com/pricing",
        title: "Neon",
        retrievedAt: "2026-11-03T10:00:01Z",
      },
    ],
  );
  const result = await agent.run({
    conversationId: id,
    message:
      "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?",
    timezone: "UTC",
    emit: () => {},
  });
  // "Last Tuesday" on Wednesday means the previous day; this fixture is deliberately a week earlier.
  assert.match(result.message.content, /no saved conversation/i);
  assert.equal(calls, 0);
  const result2 = await agent.run({
    conversationId: id,
    message:
      "On 3 November I asked about Postgres hosting. Has pricing changed?",
    timezone: "UTC",
    emit: () => {},
  });
  assert.match(result2.message.content, /Then \$19/);
  assert.deepEqual(
    result2.message.sources.map((s) => s.id),
    ["H1", "S1"],
  );
});
test("missing dated history never calls a model or invents a shortlist", async (t) => {
  const { agent, id } = setup(
    t,
    {
      complete: async () => {
        throw new Error("should not call");
      },
    },
    null,
  );
  const result = await agent.run({
    conversationId: id,
    message: "What did I ask you on 3 November?",
    timezone: "UTC",
    emit: () => {},
  });
  assert.match(result.message.content, /no saved conversation/i);
  assert.equal(result.metrics.searches, 0);
});
test("tool budget terminates repeated calls and unknown tools are never executed", async (t) => {
  let rounds = 0,
    searches = 0;
  const { agent, id } = setup(
    t,
    {
      complete: async (o) => {
        rounds++;
        return o.tools.length
          ? tool(["a", "b", "c"])
          : answer("Unable to establish more.");
      },
    },
    {
      search: async () => {
        searches++;
        return { retrievedAt: "2026-11-11T12:00:00Z", results: [] };
      },
    },
  );
  await agent.run({
    conversationId: id,
    message: "Research this",
    timezone: "UTC",
    emit: () => {},
  });
  assert.ok(rounds <= 3);
  assert.ok(searches <= 6);
  const other = setup(
    t,
    {
      complete: async (o) =>
        o.tools.length ? tool(["x"], "shell") : answer("Cannot run that"),
    },
    {
      search: async () => {
        throw new Error("must not execute");
      },
    },
  );
  await other.agent.run({
    conversationId: other.id,
    message: "Hello",
    timezone: "UTC",
    emit: () => {},
  });
});
test("search errors are disclosed and demo never pretends to use live services", async (t) => {
  let calls = 0;
  const { agent, id } = setup(
    t,
    {
      complete: async () =>
        ++calls === 1
          ? tool(["pricing"])
          : answer("I cannot confirm a change."),
    },
    {
      search: async () => {
        throw new Error("Search unavailable");
      },
    },
  );
  const result = await agent.run({
    conversationId: id,
    message: "Has pricing changed?",
    timezone: "UTC",
    emit: () => {},
  });
  assert.match(result.message.content, /could not verify/i);
  const demo = setup(t, null, null, "demo");
  const result2 = await demo.agent.run({
    conversationId: demo.id,
    message: "Latest news?",
    timezone: "UTC",
    emit: () => {},
  });
  assert.match(result2.message.content, /offline demo/i);
  assert.equal(result2.metrics.searches, 0);
});
test("source follow-ups retain recent provenance and never reuse old S IDs", async (t) => {
  let seen;
  const model = {
    complete: async (o) => {
      seen = o.messages.map((m) => m.content).join("\n");
      return answer("Here is the source [H1].");
    },
  };
  const { agent, memory, id } = setup(t, model, null);
  memory.addMessage(id, "user", "Explain the offer", "2026-11-09T10:00:00Z");
  memory.addMessage(
    id,
    "assistant",
    "The price is $19 [S1].",
    "2026-11-09T10:00:01Z",
    [
      {
        id: "S1",
        url: "https://neon.com/pricing",
        title: "Pricing",
        content: "$19",
        retrievedAt: "2026-11-09T10:00:01Z",
      },
    ],
  );
  const result = await agent.run({
    conversationId: id,
    message: "Can you link the source?",
    timezone: "UTC",
    emit: () => {},
  });
  assert.match(seen, /https:\/\/neon.com\/pricing/);
  assert.match(seen, /price is \$19 \[H1\]/);
  assert.doesNotMatch(seen, /price is \$19 \[S1\]/);
  assert.equal(result.message.sources[0].id, "H1");
  assert.equal(result.message.sources[0].historical, true);
});
test("large recent source histories have a hard prompt budget", async (t) => {
  let size = 0;
  const { agent, memory, id } = setup(
    t,
    {
      complete: async (options) => {
        size = options.messages.reduce(
          (n, m) => n + String(m.content).length,
          0,
        );
        return answer("A brief answer.");
      },
    },
    null,
  );
  for (let i = 0; i < 12; i++) {
    memory.addMessage(
      id,
      "user",
      "A long conversation " + i,
      "2026-11-03T10:00:00Z",
    );
    memory.addMessage(
      id,
      "assistant",
      "Recorded details ".repeat(300),
      "2026-11-03T10:00:01Z",
      Array.from({ length: 20 }, (_, j) => ({
        id: `S${j}`,
        url: `https://example.com/${i}/${j}`,
        content: "x".repeat(2400),
        retrievedAt: "2026-11-03T10:00:01Z",
      })),
    );
  }
  await agent.run({
    conversationId: id,
    message: "Hello",
    timezone: "UTC",
    emit: () => {},
  });
  assert.ok(size < 90_000, `Prompt was ${size} characters`);
});
