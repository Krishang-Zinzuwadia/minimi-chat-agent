import test from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../lib/types";
import { discardProvisionalTurn } from "../lib/client/recovery";
const message = (
  id: number,
  role: "user" | "assistant",
  content: string,
): Message => ({
  id,
  role,
  content,
  conversationId: "c",
  createdAt: "2026-11-11T00:00:00Z",
  sources: [],
  metadata: {},
});
test("rejected turn removes both optimistic user and partial assistant without altering prior history", () => {
  const saved = [
    message(1, "user", "Saved question"),
    message(2, "assistant", "Saved answer"),
  ];
  const optimistic = [
    ...saved,
    message(-10, "user", "Retry me"),
    message(-11, "assistant", "Incomplete answer"),
  ];
  assert.deepEqual(discardProvisionalTurn(optimistic, -10), saved);
  assert.equal(optimistic.length, 4);
});
test("unrelated IDs and empty history are preserved during optimistic cleanup", () => {
  assert.deepEqual(discardProvisionalTurn([], -10), []);
  const saved = [
    message(-4, "user", "Earlier successful turn"),
    message(8, "assistant", "Final answer"),
  ];
  assert.deepEqual(discardProvisionalTurn(saved, -10), saved);
});
