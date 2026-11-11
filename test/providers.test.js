import test from "node:test";
import assert from "node:assert/strict";
import { ModelProvider, SearchProvider, safeUrl } from "../src/providers.js";
const sse = (records) =>
  new Response(
    records.map((x) => `data: ${JSON.stringify(x)}\n\n`).join("") +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
test("model assembles fragmented tool calls and streams real content", async () => {
  const model = new ModelProvider({
    apiKey: "test",
    model: "test-model",
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.stream, true);
      assert.equal(body.tools[0].function.name, "web_search");
      return sse([
        {
          choices: [
            {
              delta: {
                content: "Checking ",
                tool_calls: [
                  {
                    index: 0,
                    id: "call1",
                    type: "function",
                    function: { name: "web_search", arguments: '{"queries":' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: "now",
                tool_calls: [
                  { index: 0, function: { arguments: '["Neon pricing"]}' } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]);
    },
  });
  let text = "";
  const result = await model.complete({
    messages: [],
    tools: [{ type: "function", function: { name: "web_search" } }],
    onDelta: (x) => (text += x),
  });
  assert.equal(text, "Checking now");
  assert.equal(
    result.tool_calls[0].function.arguments,
    '{"queries":["Neon pricing"]}',
  );
});
test("model refuses truncated output and hides provider error bodies", async () => {
  const model = new ModelProvider({
    apiKey: "secret",
    model: "test",
    fetchImpl: async () =>
      sse([
        {
          choices: [{ delta: { content: "partial" }, finish_reason: "length" }],
        },
      ]),
  });
  await assert.rejects(() => model.complete({ messages: [] }), /truncated/i);
  const bad = new ModelProvider({
    apiKey: "secret",
    model: "test",
    fetchImpl: async () => new Response("secret leaked", { status: 401 }),
  });
  await assert.rejects(
    () => bad.complete({ messages: [] }),
    (e) => e.message.includes("401") && !e.message.includes("secret"),
  );
});
test("search caches normal queries but freshness checks bypass local cache", async () => {
  let calls = 0;
  const search = new SearchProvider({
    apiKey: "test",
    fetchImpl: async () => {
      calls++;
      return Response.json({
        results: [
          {
            title: "Pricing",
            url: "https://neon.com/pricing",
            content: "$19",
            published_date: "2026-11-01",
          },
          { title: "Unsafe", url: "javascript:alert(1)", content: "bad" },
        ],
      });
    },
  });
  const a = await search.search("Neon pricing");
  const b = await search.search("Neon pricing");
  assert.equal(a.results.length, 1);
  assert.equal(a.results[0].url, "https://neon.com/pricing");
  assert.ok(a.retrievedAt);
  assert.equal(b.cached, true);
  assert.equal(calls, 1);
  await search.search("Neon pricing", { fresh: true });
  assert.equal(calls, 2);
});
test("search propagates API failure, validates queries and safe links", async () => {
  const search = new SearchProvider({
    apiKey: "x",
    fetchImpl: async () => new Response("", { status: 403 }),
  });
  await assert.rejects(() => search.search("hello"), /403/);
  await assert.rejects(() => search.search(""), /query/i);
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("https://user:pass@example.com"), null);
  assert.equal(
    safeUrl("https://example.com/a#part"),
    "https://example.com/a#part",
  );
});
