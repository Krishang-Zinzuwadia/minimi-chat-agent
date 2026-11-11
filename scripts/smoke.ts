import { spawn } from "node:child_process";
import assert from "node:assert/strict";

// Actual compiled Next server, isolated demo config, no external provider calls.
const port = Number(process.env.SMOKE_PORT || "3187");
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEMO_MODE: "true",
      AUTH_MODE: "local",
      OPENAI_API_KEY: "",
      FIRECRAWL_API_KEY: "",
      DATABASE_URL: "",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      TIMEZONE: "UTC",
      CF_ACCESS_TEAM_DOMAIN: "",
      CF_ACCESS_AUD: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
server.stdout?.on("data", (b) => {
  log += String(b);
});
server.stderr?.on("data", (b) => {
  log += String(b);
});
const post = (path: string, body: unknown) =>
  fetch(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
try {
  let ready = false;
  for (let n = 0; n < 80; n++) {
    if (server.exitCode !== null)
      throw new Error("Next server exited before startup.");
    try {
      ready = (await fetch(origin + "/api/status")).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "Next server did not start");
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<h1>What are you working on/);
  assert.match(page.headers.get("cache-control") ?? "", /private/);
  assert.match(page.headers.get("cache-control") ?? "", /no-store/);
  const dark = await fetch(origin, {
    headers: { Cookie: "recall-theme=dark" },
  });
  assert.match(await dark.text(), /data-theme="dark"/);
  const invalid = await fetch(origin, {
    headers: { Cookie: "recall-theme=invalid" },
  });
  assert.match(await invalid.text(), /data-theme="system"/);
  const suggestions = await fetch(origin + "/api/suggestions");
  assert.equal(suggestions.status, 200);
  const prompts = (await suggestions.json()) as {
    suggestions: unknown[];
    personalized: boolean;
  };
  assert.equal(prompts.suggestions.length, 3);
  assert.equal(prompts.personalized, false);
  const created = await post("/api/conversations", {});
  assert.equal(created.status, 201);
  const c = (await created.json()) as { id: string };
  const response = await post("/api/chat", {
    conversationId: c.id,
    message: "Smoke check for temporal memory",
    timezone: "UTC",
  });
  assert.equal(response.status, 200);
  const sse = await response.text();
  assert.match(sse, /event: done/);
  assert.match(sse, /Offline demo/);
  const saved = (await (
    await fetch(origin + "/api/conversations/" + c.id)
  ).json()) as { messages: unknown[] };
  assert.equal(saved.messages.length, 2);
  const bad = await fetch(origin + "/api/conversations", {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(bad.status, 403);
  console.log(
    "Production HTTP smoke passed: page/theme cookies/cache protection, generic suggestions, create, SSE, stored history and cross-origin rejection. No live providers called.",
  );
} catch (error) {
  console.error(log);
  throw error;
} finally {
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null || server.signalCode) resolve();
    else server.once("exit", () => resolve());
  });
}
