import test from "node:test";
import assert from "node:assert/strict";
import type { Conversation, Message, Status } from "../lib/types";
import { createApi } from "../lib/api";
import { loadConfig } from "../lib/config";
import { DemoMemory } from "../lib/demo-memory";
import type { RunInput } from "../lib/agent";
function setup(agent?: { run: (input: RunInput) => Promise<unknown> }) {
  const memory = new DemoMemory();
  const handle = createApi({
    config: () => loadConfig({}),
    memory: () => memory,
    ...(agent ? { agent: () => agent } : {}),
  });
  const get = (path: string) =>
    handle(new Request("http://localhost:3000" + path));
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    handle(
      new Request("http://localhost:3000" + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
  return { memory, handle, get, post };
}
test("Next API contract supports conversations, actual SSE completion and storage", async () => {
  const { post, get } = setup();
  assert.equal(
    ((await (await get("/api/status")).json()) as Status).mode,
    "demo",
  );
  const conversation = (await (
    await post("/api/conversations", {})
  ).json()) as Conversation;
  const response = await post("/api/chat", {
    conversationId: conversation.id,
    message: "Hello",
    timezone: "Asia/Kolkata",
  });
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/event-stream/,
  );
  assert.match(await response.text(), /event: done/);
  const history = (await (
    await get("/api/conversations/" + conversation.id)
  ).json()) as { messages: Message[] };
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[1].metadata.mode, "demo");
});
test("API rejects malformed payloads, cross-origin, oversized body and unsafe timezone", async () => {
  const { post, handle } = setup();
  assert.equal(
    (await post("/api/conversations", {}, { origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.equal((await post("/api/chat", { message: "Hi" })).status, 400);
  const c = (await (
    await post("/api/conversations", {})
  ).json()) as Conversation;
  assert.equal(
    (
      await post("/api/chat", {
        conversationId: c.id,
        message: "Hi",
        timezone: "invalid",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/api/chat", {
        conversationId: c.id,
        message: "x".repeat(30_000),
      })
    ).status,
    413,
  );
  assert.equal(
    (await handle(new Request("https://public.example/api/conversations")))
      .status,
    503,
  );
});
test("lease prevents parallel turns and releases after failure", async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  let calls = 0;
  const { post, memory } = setup({
    run: async () => {
      calls++;
      if (calls === 1) await wait;
      throw new Error("failed");
    },
  });
  const c = await memory.createConversation();
  const first = await post("/api/chat", {
    conversationId: c.id,
    message: "One",
  });
  assert.equal(
    (await post("/api/chat", { conversationId: c.id, message: "Two" })).status,
    429,
  );
  release();
  assert.match(await first.text(), /event: error/);
  const third = await post("/api/chat", {
    conversationId: c.id,
    message: "Three",
  });
  assert.equal(third.status, 200);
  await third.text();
});
test("consumer cancellation aborts work and releases the database lease", async () => {
  let stopped = false;
  const { post, memory } = setup({
    run: async ({ signal }) =>
      new Promise<void>((resolve) => {
        signal?.addEventListener(
          "abort",
          () => {
            stopped = true;
            resolve();
          },
          { once: true },
        );
      }),
  });
  const c = await memory.createConversation();
  const response = await post("/api/chat", {
    conversationId: c.id,
    message: "One",
  });
  await response.body!.cancel();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(stopped, true);
  assert.equal(
    await memory.acquireLease(
      c.id,
      "new",
      new Date(Date.now() + 10000).toISOString(),
    ),
    true,
  );
});
