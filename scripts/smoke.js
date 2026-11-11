import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const directory = await mkdtemp(join(tmpdir(), "recall-smoke-"));
const child = spawn(
  process.execPath,
  ["--env-file-if-exists=.env", "src/server.js"],
  {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: directory,
      DEMO_MODE: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exit = new Promise((resolve) => child.once("exit", resolve));
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Startup timed out")),
      10_000,
    );
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("http://localhost:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Server exited before readiness"));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await (await fetch(base + "/api/status")).json()).mode, "demo");
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const conversation = await (await post("/api/conversations", {})).json();
  const stream = await (
    await post("/api/chat", {
      conversationId: conversation.id,
      message: "Hello",
      timezone: "UTC",
    })
  ).text();
  assert.match(stream, /event: done/);
  assert.match(stream, /Offline demo/);
  assert.equal(
    (await (await fetch(base + `/api/conversations/${conversation.id}`)).json())
      .messages.length,
    2,
  );
  console.log(
    "Startup, HTTP, SSE and persistence smoke passed. No external API calls.",
  );
} finally {
  child.kill("SIGTERM");
  await exit;
  await rm(directory, { recursive: true, force: true });
}
