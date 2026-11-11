import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const context = { module: { exports: {} }, URL };
vm.runInNewContext(
  readFileSync(new URL("../public/app.js", import.meta.url), "utf8"),
  context,
);
const { createSSEParser, safeSourceURL } = context.module.exports;
test("SSE parser preserves split UTF-8 and CRLF event frames", () => {
  const events = [];
  const parser = createSSEParser((event, data) => events.push([event, data]));
  const decoder = new TextDecoder();
  const wire =
    ': heartbeat\r\nevent: delta\r\ndata: {"text":"Hello 🌍"}\r\n\r\nevent: done\ndata: {"ok":true}\n\n';
  for (const byte of new TextEncoder().encode(wire))
    parser.push(decoder.decode(Uint8Array.of(byte), { stream: true }));
  parser.push(decoder.decode());
  parser.finish();
  assert.equal(
    JSON.stringify(events),
    JSON.stringify([
      ["delta", { text: "Hello 🌍" }],
      ["done", { ok: true }],
    ]),
  );
});
test("SSE parser joins multiple data lines and flushes last record", () => {
  const events = [];
  const parser = createSSEParser((event, data) => events.push([event, data]));
  parser.push('event: memory\ndata: {"count":1,\ndata: "dates":[]}');
  parser.finish();
  assert.equal(
    JSON.stringify(events),
    JSON.stringify([["memory", { count: 1, dates: [] }]]),
  );
});
test("Source links allow only absolute HTTP or HTTPS URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "/relative",
    "not a url",
    "file:///etc/passwd",
  ])
    assert.equal(safeSourceURL(url), null);
  assert.equal(safeSourceURL("https://example.com"), "https://example.com/");
});
