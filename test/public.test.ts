import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { loadConfig } from "../lib/config";
import { authorize } from "../lib/auth";
import { createApi } from "../lib/api";
import { getDemoMemory } from "../lib/demo-memory";
import { PublicLimits } from "../lib/public-limits";
const origin = "https://minimi.example";
const config = loadConfig({
  AUTH_MODE: "public",
  PUBLIC_ORIGIN: origin,
  PUBLIC_SESSION_SECRET: "a".repeat(48),
  OPENAI_API_KEY: "test",
  FIRECRAWL_API_KEY: "test",
  DATABASE_URL: "postgresql://test:test@example.com/test",
  OPENAI_MODEL: "other-model",
});
const req = (
  path: string,
  cookie?: string,
  method = "GET",
  requestOrigin: string | null = origin,
) =>
  new Request(origin + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      "content-type": "application/json",
    },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
test("public config fails closed and pins model", () => {
  assert.equal(config.mode, "live");
  assert.equal(config.model, "gpt-6-luna");
  assert.equal(loadConfig({ AUTH_MODE: "public" }).mode, "setup");
});
test("public sessions are signed, private, persistent, scoped and CSRF protected", async () => {
  const headers = new Headers();
  const first = await authorize(req("/api/conversations"), config, headers);
  const cookie = headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(cookie, /^__Host-minimi=/);
  assert.match(first, /^visitor:/);
  assert.equal(
    await authorize(req("/api/conversations", cookie.split(";")[0]), config),
    first,
  );
  assert.notEqual(
    await authorize(req("/api/conversations"), config, new Headers()),
    first,
  );
  await assert.rejects(
    () => authorize(req("/api/chat", cookie, "POST", null), config),
    /same-origin/,
  );
  await assert.rejects(
    () =>
      authorize(
        req("/api/chat", cookie, "POST", "https://evil.example"),
        config,
      ),
    /origin/,
  );
  await assert.rejects(
    () => authorize(req("/api/chat", "__Host-minimi=forged", "POST"), config),
    /Reload/,
  );
  await assert.rejects(
    () =>
      authorize(
        new Request("https://alternate.example/api/conversations"),
        config,
        new Headers(),
      ),
    /same-origin/,
  );
  const forgedOwner = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("cf:owner")
    .setIssuedAt()
    .setExpirationTime("1d")
    .setAudience(origin)
    .setIssuer("minimi-public")
    .sign(new TextEncoder().encode(config.sessionSecret));
  await assert.rejects(
    () =>
      authorize(
        req("/api/chat", `__Host-minimi=${forgedOwner}`, "POST"),
        config,
      ),
    /Reload/,
  );
});
test("public API bootstraps isolated visitors, cannot read another owner and fails closed on limits", async () => {
  const admitted: string[] = [];
  const api = createApi({
    config: () => config,
    memory: (_, owner) => getDemoMemory(owner),
    limits: () => ({
      admit: async (owner, kind) => {
        admitted.push(`${owner}:${kind}`);
      },
    }),
  });
  const first = await api(req("/api/conversations"));
  const a = first.headers.get("set-cookie")!.split(";")[0];
  const second = await api(req("/api/conversations"));
  const b = second.headers.get("set-cookie")!.split(";")[0];
  const created = await api(req("/api/conversations", a, "POST"));
  assert.equal(created.status, 201);
  const conversation = (await created.json()) as { id: string };
  assert.equal(
    (await api(req(`/api/conversations/${conversation.id}`, b))).status,
    404,
  );
  assert.deepEqual(await (await api(req("/api/conversations", b))).json(), []);
  assert.equal(
    (await api(req(`/api/conversations/${conversation.id}`, a))).status,
    200,
  );
  assert.equal(
    (await api(req("/api/conversations", a, "POST", null))).status,
    403,
  );
  assert.ok(admitted.length >= 6);
  const fail = createApi({
    config: () => config,
    limits: () => ({
      admit: async () => {
        throw new Error("DB unavailable");
      },
    }),
  });
  const denied = await fail(req("/api/conversations"));
  assert.equal(denied.status, 500);
  assert.equal(denied.headers.get("set-cookie"), null);
});
test("durable caps admit atomically, reset only daily count and never refund lifetime", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile } = await import("node:fs/promises");
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
    );
    const limits = new PublicLimits(
      "",
      async (sql, params) =>
        (await db.query<Record<string, unknown>>(sql, params)).rows,
    );
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => limits.take("race", 3, 5)),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
    await db.exec("UPDATE public_limits SET day=day-1 WHERE scope='race'");
    await limits.take("race", 3, 5);
    await limits.take("race", 3, 5);
    await assert.rejects(() => limits.take("race", 3, 5), /usage limit/);
    const rows = await db.query<{ daily_count: number; total_count: number }>(
      "SELECT * FROM public_limits WHERE scope='race'",
    );
    assert.equal(rows.rows[0].daily_count, 2);
    assert.equal(rows.rows[0].total_count, 5);
  } finally {
    await db.close();
  }
});
