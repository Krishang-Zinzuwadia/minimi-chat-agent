import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Memory } from "../src/memory.js";
import { Agent } from "../src/agent.js";
async function start(t, overrideAgent) {
  const memory = new Memory(":memory:");
  const agent = overrideAgent || new Agent({ memory, mode: "demo" });
  const server = createApp({
    memory,
    agent,
    config: { mode: "demo", model: "offline", timezone: "UTC" },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    memory.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { url, post, memory };
}
test("HTTP supports durable conversation and complete SSE chat lifecycle", async (t) => {
  const { url, post } = await start(t);
  assert.equal((await fetch(url + "/api/status")).status, 200);
  const c = await (await post("/api/conversations", {})).json();
  assert.ok(c.id);
  const response = await post("/api/chat", {
    conversationId: c.id,
    message: "Hello",
    timezone: "Asia/Kolkata",
  });
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /event: done/);
  assert.match(text, /Offline demo/);
  const history = await (
    await fetch(url + `/api/conversations/${c.id}`)
  ).json();
  assert.equal(history.messages.length, 2);
  assert.equal((await fetch(url + "/")).status, 200);
});
test("HTTP rejects unsafe origins, malformed inputs, invalid timezone and missing chats", async (t) => {
  const { post } = await start(t);
  assert.equal(
    (await post("/api/conversations", {}, { origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.equal((await post("/api/chat", { message: "hi" })).status, 400);
  assert.equal(
    (
      await post("/api/chat", {
        conversationId: "missing",
        message: "Hi",
        timezone: "UTC",
      })
    ).status,
    404,
  );
  const c = await (await post("/api/conversations", {})).json();
  assert.equal(
    (
      await post("/api/chat", {
        conversationId: c.id,
        message: "Hi",
        timezone: "bad",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/api/chat", {
        conversationId: c.id,
        message: "x".repeat(5000),
      })
    ).status,
    400,
  );
});
test("same conversation cannot run concurrent turns; error releases its lock", async (t) => {
  let release;
  const waiting = new Promise((resolve) => (release = resolve));
  let count = 0;
  const { post, memory } = await start(t, {
    run: async () => {
      count++;
      if (count === 1) await waiting;
      throw new Error("Provider unavailable");
    },
  });
  const c = memory.createConversation();
  const first = await post("/api/chat", {
    conversationId: c.id,
    message: "First",
  });
  assert.equal(
    (await post("/api/chat", { conversationId: c.id, message: "Second" }))
      .status,
    409,
  );
  release();
  assert.match(await first.text(), /event: error/);
  const third = await post("/api/chat", {
    conversationId: c.id,
    message: "Third",
  });
  assert.equal(third.status, 200);
  await third.text();
});
test("configuration uses explicit demo and refuses incomplete credentials or unsafe remote HTTP", () => {
  assert.equal(loadConfig({}).mode, "demo");
  assert.equal(
    loadConfig({ OPENAI_API_KEY: "x", TAVILY_API_KEY: "y" }).mode,
    "live",
  );
  assert.throws(() => loadConfig({ OPENAI_API_KEY: "x" }), /both/i);
  assert.throws(
    () => loadConfig({ OPENAI_BASE_URL: "http://evil.example/v1" }),
    /https/i,
  );
});
test("non-string message is a client error, not a server error", async (t) => {
  const { post, memory } = await start(t);
  const c = memory.createConversation();
  assert.equal(
    (await post("/api/chat", { conversationId: c.id, message: { trim: true } }))
      .status,
    400,
  );
});
