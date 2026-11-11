import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../lib/config";
import { authorize } from "../lib/auth";
test("configuration needs three live secrets and never silently falls back when partial", () => {
  assert.equal(loadConfig({}).mode, "demo");
  assert.equal(loadConfig({ OPENAI_API_KEY: "x" }).mode, "setup");
  const live = loadConfig({
    OPENAI_API_KEY: "x",
    FIRECRAWL_API_KEY: "y",
    DATABASE_URL: "postgresql://u:p@example.neon.tech/db?sslmode=require",
  });
  assert.equal(live.mode, "live");
  assert.equal(live.model, "gpt-6-luna");
  assert.equal(
    loadConfig({ DEMO_MODE: "true", OPENAI_API_KEY: "x" }).mode,
    "demo",
  );
  assert.equal(
    loadConfig({ OPENAI_BASE_URL: "http://evil.example" }).mode,
    "setup",
  );
});
test("local auth allows only actual loopback and rejects cross-origin requests", async () => {
  const config = loadConfig({});
  assert.equal(
    await authorize(new Request("http://localhost:3000/api/chat"), config),
    "local-dev",
  );
  await assert.rejects(
    () => authorize(new Request("https://public.example/api/chat"), config),
    /local|configured/i,
  );
  await assert.rejects(
    () =>
      authorize(
        new Request("http://localhost:3000/api/chat", {
          headers: { origin: "https://evil.example" },
        }),
        config,
      ),
    /origin/i,
  );
  await assert.rejects(
    () =>
      authorize(
        new Request("http://localhost:3000/api/chat", {
          headers: { host: "evil.example" },
        }),
        config,
      ),
    /host/i,
  );
});
test("Access mode fails closed for missing config and missing/forged JWTs", async () => {
  const blank = loadConfig({ AUTH_MODE: "cloudflare-access" });
  await assert.rejects(
    () => authorize(new Request("https://example.workers.dev/api/chat"), blank),
    /configured/i,
  );
  const configured = loadConfig({
    AUTH_MODE: "cloudflare-access",
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
    CF_ACCESS_AUD: "aud",
  });
  await assert.rejects(
    () =>
      authorize(
        new Request("https://example.workers.dev/api/chat"),
        configured,
      ),
    /sign in/i,
  );
  await assert.rejects(
    () =>
      authorize(
        new Request("https://example.workers.dev/api/chat", {
          headers: { "cf-access-jwt-assertion": "not.a.token" },
        }),
        configured,
      ),
    /sign in/i,
  );
});
test("NextRequest loopback normalization preserves genuine Host and Origin checks", async () => {
  const { NextRequest } = await import("next/server");
  const config = loadConfig({});
  const request = new NextRequest("http://127.0.0.1:3999/api/conversations", {
    headers: { host: "127.0.0.1:3999", origin: "http://127.0.0.1:3999" },
  });
  assert.equal(await authorize(request, config), "local-dev");
  await assert.rejects(
    () =>
      authorize(
        new NextRequest("http://127.0.0.1:3999/api/chat", {
          headers: { host: "127.0.0.1:3000" },
        }),
        config,
      ),
    /host/i,
  );
  await assert.rejects(
    () =>
      authorize(
        new NextRequest("http://127.0.0.1:3999/api/chat", {
          headers: { host: "evil.example:3999" },
        }),
        config,
      ),
    /host/i,
  );
  await assert.rejects(
    () =>
      authorize(
        new NextRequest("http://127.0.0.1:3999/api/chat", {
          headers: {
            host: "127.0.0.1:3999",
            origin: "http://evil.example:3999",
          },
        }),
        config,
      ),
    /origin/i,
  );
});
test("Access validates a real signature, audience, issuer and expiry using fixture keys", async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "fixture";
  jwk.alg = "RS256";
  const issuer = "https://fixture.cloudflareaccess.com";
  const config = loadConfig({
    AUTH_MODE: "cloudflare-access",
    CF_ACCESS_TEAM_DOMAIN: issuer,
    CF_ACCESS_AUD: "app-audience",
  });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), issuer + "/cdn-cgi/access/certs");
    calls++;
    return Response.json({ keys: [jwk] });
  };
  const token = (aud = "app-audience", iss = issuer, exp = "5m") =>
    new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setSubject("owner-one")
      .setIssuedAt()
      .setAudience(aud)
      .setIssuer(iss)
      .setExpirationTime(exp)
      .sign(privateKey);
  const request = (jwt: string) =>
    new Request("https://app.example/api/chat", {
      headers: { "cf-access-jwt-assertion": jwt },
    });
  try {
    assert.equal(
      await authorize(request(await token()), config),
      "cf:owner-one",
    );
    assert.equal(calls, 1);
    await assert.rejects(() =>
      authorize(request("bad.signature.token"), config),
    );
    await assert.rejects(async () =>
      authorize(request(await token("wrong")), config),
    );
    await assert.rejects(async () =>
      authorize(
        request(
          await token("app-audience", "https://wrong.cloudflareaccess.com"),
        ),
        config,
      ),
    );
    await assert.rejects(async () =>
      authorize(request(await token("app-audience", issuer, "-10m")), config),
    );
  } finally {
    globalThis.fetch = original;
  }
});
