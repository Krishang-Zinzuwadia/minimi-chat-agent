import test from "node:test";
import assert from "node:assert/strict";
import { ResponsesModel, FirecrawlSearch, safeUrl } from "../lib/providers";
const sse = (records: unknown[]) =>
  new Response(records.map((x) => `data: ${JSON.stringify(x)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
test("Luna Responses preserves reasoning and function calls for stateless tool continuation", async () => {
  let body: Record<string, unknown> = {};
  const output = [
    { type: "reasoning", id: "rs1", summary: [], encrypted_content: "opaque" },
    {
      type: "function_call",
      id: "fc1",
      call_id: "call1",
      name: "web_search",
      arguments: '{"queries":["Neon pricing"]}',
    },
  ];
  const model = new ResponsesModel({
    apiKey: "test",
    fetchImpl: async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return sse([
        { type: "response.output_text.delta", delta: "Checking now." },
        {
          type: "response.completed",
          response: { id: "resp1", status: "completed", output },
        },
      ]);
    },
  });
  let text = "";
  const result = await model.complete({
    instructions: "Be accurate",
    input: [{ role: "user", content: "pricing" }],
    tools: [
      { type: "function", name: "web_search", parameters: { type: "object" } },
    ],
    toolChoice: "required",
    onDelta: (part: string) => (text += part),
  });
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.store, false);
  assert.deepEqual(body.reasoning, { effort: "low" });
  assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
  assert.equal(text, "Checking now.");
  assert.equal(result.toolCalls[0].callId, "call1");
  assert.deepEqual(result.output, output);
});
test("model rejects incomplete output and redacts provider error bodies", async () => {
  const model = new ResponsesModel({
    apiKey: "test",
    fetchImpl: async () =>
      sse([
        {
          type: "response.incomplete",
          response: {
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
          },
        },
      ]),
  });
  await assert.rejects(
    () => model.complete({ instructions: "", input: [], tools: [] }),
    /incomplete|truncated/i,
  );
  const bad = new ResponsesModel({
    apiKey: "test",
    fetchImpl: async () =>
      Response.json(
        {
          error: {
            message: "sensitive provider text",
            type: "authentication_error",
          },
        },
        { status: 401 },
      ),
  });
  await assert.rejects(
    () => bad.complete({ instructions: "", input: [], tools: [] }),
    (e) =>
      /401/.test(String(e)) && !String(e).includes("sensitive provider text"),
  );
});
test("Firecrawl sole search tool returns page excerpts and forces fresh fetches", async () => {
  let calls = 0;
  const bodies: Record<string, unknown>[] = [];
  const search = new FirecrawlSearch({
    apiKey: "test",
    fetchImpl: async (_url: unknown, init?: RequestInit) => {
      calls++;
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        success: true,
        data: {
          web: [
            {
              title: "Neon",
              url: "https://neon.com/pricing",
              description: "A plan",
              markdown: "Current pricing $20",
              metadata: { title: "Neon" },
            },
            { title: "bad", url: "javascript:alert(1)", description: "x" },
          ],
        },
      });
    },
  });
  const a = await search.search("Neon pricing");
  const b = await search.search("Neon pricing");
  assert.equal(a.results.length, 1);
  assert.equal(a.results[0].content, "Current pricing $20");
  assert.equal(b.cached, true);
  assert.equal(calls, 1);
  await search.search("Neon pricing", { fresh: true });
  assert.equal(calls, 2);
  assert.equal((bodies[1].scrapeOptions as { maxAge: number }).maxAge, 0);
  assert.equal(bodies[1].domainTools, false);
});
test("search fails safely, validates shape and blocks unsafe URLs", async () => {
  const search = new FirecrawlSearch({
    apiKey: "x",
    fetchImpl: async () =>
      Response.json({ success: false, error: "secret details" }),
  });
  await assert.rejects(() => search.search("hi"), /Search/);
  await assert.rejects(() => search.search(""), /query/i);
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("https://user:password@example.com"), null);
  assert.equal(safeUrl("https://example.com/a"), "https://example.com/a");
});

test("public provider budgets fail closed, pin Luna, bound output and disable retries", async () => {
  let calls = 0,
    admissions = 0;
  const model = new ResponsesModel({
    apiKey: "test",
    model: "unapproved",
    publicMode: true,
    beforeRequest: async () => {
      admissions++;
    },
    fetchImpl: async (_, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-6-luna");
      assert.equal(body.max_output_tokens, 1500);
      return Response.json({ error: { message: "failure" } }, { status: 500 });
    },
  });
  await assert.rejects(() =>
    model.complete({ instructions: "", input: [], tools: [] }),
  );
  assert.equal(calls, 1);
  assert.equal(admissions, 1);
  await assert.rejects(
    () =>
      model.complete({ instructions: "x".repeat(48001), input: [], tools: [] }),
    /context/,
  );
  assert.equal(calls, 1);
  assert.equal(admissions, 1);
  const deny = async () => {
    throw new Error("usage limit");
  };
  const blocked = new ResponsesModel({
    apiKey: "test",
    publicMode: true,
    beforeRequest: deny,
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
  });
  await assert.rejects(
    () => blocked.complete({ instructions: "", input: [], tools: [] }),
    /usage limit/,
  );
  const search = new FirecrawlSearch({
    apiKey: "test",
    beforeRequest: deny,
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
  });
  await assert.rejects(() => search.search("test"), /usage limit/);
});
