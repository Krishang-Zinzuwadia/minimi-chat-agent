import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NeonMemory } from "../lib/memory";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
const owner = "verification:" + randomUUID();
const memory = new NeonMemory(url, owner);
const other = new NeonMemory(url, "verification:other:" + randomUUID());
const now = new Date().toISOString();
const conversation = await memory.createConversation(now);
await memory.addMessage(
  conversation.id,
  "user",
  "Neon persistence verification question",
  now,
);
await memory.addMessage(
  conversation.id,
  "assistant",
  "Verified persistent answer",
  now,
);
const reloaded = new NeonMemory(url, owner);
assert.equal((await reloaded.messages(conversation.id)).length, 2);
assert.equal((await reloaded.conversations()).length, 1);
assert.equal(await other.conversation(conversation.id), null);
assert.deepEqual(await other.messages(conversation.id), []);
assert.equal((await reloaded.recentQuestions()).length, 1);
assert.equal((await reloaded.retrieve("Neon persistence")).memories.length, 1);
const expiry = new Date(Date.now() + 60000).toISOString();
assert.equal(
  await reloaded.acquireLease(conversation.id, "verify-a", expiry),
  true,
);
assert.equal(
  await reloaded.acquireLease(conversation.id, "verify-b", expiry),
  false,
);
await reloaded.releaseLease(conversation.id, "verify-a");
assert.equal(
  await reloaded.acquireLease(conversation.id, "verify-b", expiry),
  true,
);
await reloaded.releaseLease(conversation.id, "verify-b");
console.log(
  "PASS: live Neon persistence, reload, owner isolation, recent questions, lexical recall and atomic leases.",
);
console.log(
  "Synthetic verification records retained; no existing records modified.",
);
