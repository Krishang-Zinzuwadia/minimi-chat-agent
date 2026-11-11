import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventParser, safeSourceUrl } from "../lib/client/stream";
test("assembles split SSE chunks and CRLF frames", () => {
  const events: { event: string; data: unknown }[] = [];
  const parser = createEventParser((e) => events.push(e));
  parser.push('event: delta\r\ndata: {"te');
  parser.push('xt":"hello"}\r\n\r\nevent: done\ndata: {"ok":true}\n\n');
  assert.deepEqual(events, [
    { event: "delta", data: { text: "hello" } },
    { event: "done", data: { ok: true } },
  ]);
});
test("ignores malformed payloads and comments", () => {
  const events: unknown[] = [];
  const parser = createEventParser((e) => events.push(e));
  parser.push(": keepalive\n\nevent: delta\ndata: nope\n\n");
  assert.deepEqual(events, []);
});
test("only public http source links are eligible", () => {
  assert.equal(safeSourceUrl("javascript:alert(1)"), null);
  assert.equal(safeSourceUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeSourceUrl("/unverified"), null);
});
