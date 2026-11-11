import test from "node:test";
import assert from "node:assert/strict";
import { DemoMemory, getDemoMemory } from "../lib/demo-memory";
import { NeonMemory, type QueryExecutor } from "../lib/memory";
const now = new Date("2026-11-11T18:00:00Z");
test("demo isolates owners and pairs only immediate assistant, retains historical sources", async () => {
  const a = getDemoMemory("test-a"),
    b = getDemoMemory("test-b");
  const c = await a.createConversation();
  await a.addMessage(c.id, "user", "Postgres pricing", "2026-11-03T18:00:00Z");
  await a.addMessage(c.id, "assistant", "Old pricing", "2026-11-03T18:01:00Z", [
    {
      id: "s1",
      title: "Prices",
      url: "https://example.com",
      retrievedAt: "2026-11-03T18:01:00Z",
    },
  ]);
  assert.equal(await b.conversation(c.id), null);
  assert.deepEqual(await b.messages(c.id), []);
  await assert.rejects(() => b.addMessage(c.id, "user", "intrude"));
  const r = await a.retrieve("What did I ask on 3 November?", now);
  assert.equal(r.memories.length, 1);
  assert.equal(r.memories[0].answer, "Old pricing");
  assert.equal(r.memories[0].sources[0].historical, true);
  assert.equal(
    (await a.retrieve("Is Postgres pricing still correct today?", now)).memories
      .length,
    1,
  );
});
test("demo lease token ownership and expiration", async () => {
  const m = new DemoMemory(),
    c = await m.createConversation();
  const expiry = new Date(Date.now() + 60000).toISOString();
  assert.equal(await m.acquireLease(c.id, "a", expiry), true);
  assert.equal(await m.acquireLease(c.id, "b", expiry), false);
  await m.releaseLease(c.id, "b");
  assert.equal(await m.acquireLease(c.id, "b", expiry), false);
  await m.releaseLease(c.id, "a");
  assert.equal(await m.acquireLease(c.id, "b", expiry), true);
});
test("bounded memory date results and negative timezone calendar", async () => {
  const m = new DemoMemory(),
    c = await m.createConversation();
  for (let i = 0; i < 14; i++)
    await m.addMessage(c.id, "user", "question " + i, "2026-11-04T01:00:00Z");
  const r = await m.retrieve("on November 3", now, "America/Los_Angeles");
  assert.equal(r.total, 14);
  assert.equal(r.memories.length, 12);
  assert.equal(r.truncated, true);
});
test("Neon queries parameterize owner, atomic leases and inserts", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const executor: QueryExecutor = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  const m = new NeonMemory("", "owner-secret", executor);
  await m.messages("00000000-0000-4000-8000-000000000000");
  await m.acquireLease(
    "00000000-0000-4000-8000-000000000000",
    "token",
    "2026-11-12T00:00:00Z",
  );
  await assert.rejects(() =>
    m.addMessage(
      "00000000-0000-4000-8000-000000000000",
      "user",
      "Robert'); DROP TABLE messages;--",
    ),
  );
  for (const c of calls) {
    assert.ok(c.params.includes("owner-secret"));
    assert.ok(!c.sql.includes("owner-secret"));
  }
  assert.match(calls[1].sql, /lease_expires_at.*CURRENT_TIMESTAMP/s);
  assert.match(
    calls[2].sql,
    /WITH.*UPDATE conversations.*INSERT INTO messages/s,
  );
});
test("Neon date predicate and sanitized OR lexical search", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const m = new NeonMemory("", "owner", async (sql, params) => {
    calls.push({ sql, params });
    return [];
  });
  await m.retrieve("on November 3", now, "America/Los_Angeles");
  assert.match(calls[0].sql, /AT TIME ZONE/);
  assert.ok(calls[0].params.includes("2026-11-03"));
  await m.retrieve('postgres OR "! & billing', now);
  assert.match(calls[1].sql, /websearch_to_tsquery/);
  assert.equal(calls[1].params[1], "postgres OR billing");
});
test("adjacent user does not borrow a later assistant and roles cannot escalate", async () => {
  const m = new DemoMemory(),
    c = await m.createConversation();
  await m.addMessage(c.id, "user", "First question", "2026-11-03T00:00:00Z");
  await m.addMessage(c.id, "user", "Second question", "2026-11-03T00:01:00Z");
  await m.addMessage(
    c.id,
    "assistant",
    "Second answer",
    "2026-11-03T00:02:00Z",
  );
  const r = await m.retrieve("on 3 November", now);
  assert.equal(
    r.memories.find((m) => m.question === "First question")?.answer,
    null,
  );
  await assert.rejects(() =>
    m.addMessage(c.id, "system" as "user", "escalate"),
  );
  const pg = new NeonMemory("", "owner", async () => {
    throw new Error("Must not query");
  });
  await assert.rejects(
    () => pg.addMessage(c.id, "system" as "user", "escalate"),
    /Invalid message role/,
  );
});
test("Neon decodes bigint IDs, preserves historical source timestamps and caps excerpts", async () => {
  const source = {
    id: "s1",
    title: "Old docs",
    url: "https://example.com",
    retrievedAt: "2026-11-03T00:00:00Z",
  };
  const pg = new NeonMemory("", "owner", async () => [
    {
      id: "42",
      conversation_id: "c",
      role: "user",
      content: "q".repeat(6000),
      created_at: "2026-11-03T00:00:00Z",
      answer: "a".repeat(8000),
      answered_at: "2026-11-03T00:01:00Z",
      answer_sources: [source],
      total: "25",
    },
  ]);
  const r = await pg.retrieve("on 3 November", now);
  assert.equal(r.total, 25);
  assert.equal(r.truncated, true);
  assert.equal(r.memories[0].id, 42);
  assert.equal(r.memories[0].question.length, 5000);
  assert.equal(r.memories[0].answer?.length, 7000);
  assert.equal(r.memories[0].sources[0].retrievedAt, source.retrievedAt);
  assert.equal(r.memories[0].sources[0].historical, true);
  const oversized = new NeonMemory("", "owner", async () => [
    {
      id: "9007199254740993",
      conversation_id: "c",
      role: "user",
      content: "x",
      created_at: "2026-11-03T00:00:00Z",
    },
  ]);
  await assert.rejects(() => oversized.messages("c"), /safe range/);
});

test("embedded PostgreSQL executes schema and actual owner-scoped SQL end to end", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile } = await import("node:fs/promises");
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
    );
    const execute: QueryExecutor = async (sql, params) =>
      (await db.query<Record<string, unknown>>(sql, params)).rows;
    const alice = new NeonMemory("", "alice", execute),
      bob = new NeonMemory("", "bob", execute);
    const c = await alice.createConversation("2026-11-03T00:00:00Z");
    assert.equal((await alice.conversation(c.id))?.title, "New conversation");
    assert.equal(await bob.conversation(c.id), null);
    assert.equal((await alice.conversations()).length, 1);
    assert.equal((await bob.conversations()).length, 0);
    const q = await alice.addMessage(
      c.id,
      "user",
      "Compare running databases",
      "2026-11-04T01:00:00Z",
    );
    const source = {
      id: "s1",
      title: "Postgres docs",
      url: "https://example.com",
      retrievedAt: "2026-11-04T01:01:00Z",
    };
    const a = await alice.addMessage(
      c.id,
      "assistant",
      "PostgreSQL offers transactions",
      "2026-11-04T01:01:00Z",
      [source],
      { mode: "live" },
    );
    assert.equal(
      (await alice.conversation(c.id))?.title,
      "Compare running databases",
    );
    assert.deepEqual(
      (await alice.messages(c.id)).map((m) => m.id),
      [q.id, a.id],
    );
    assert.equal((await alice.messages(c.id, 1))[0].id, a.id);
    assert.deepEqual(await bob.messages(c.id), []);
    await assert.rejects(
      () => bob.addMessage(c.id, "user", "intrusion"),
      /Conversation not found/,
    );
    const recall = await alice.retrieve(
      "What did I ask on November 3?",
      now,
      "America/Los_Angeles",
    );
    assert.equal(recall.total, 1);
    assert.equal(recall.memories[0].localDate, "2026-11-03");
    assert.equal(recall.memories[0].answer, a.content);
    assert.equal(recall.memories[0].sources[0].retrievedAt, source.retrievedAt);
    assert.equal(recall.memories[0].sources[0].historical, true);
    assert.equal((await alice.retrieve("on November 3", now, "UTC")).total, 0);
    assert.equal(
      (await alice.retrieve("run", now)).total,
      1,
      "English FTS stems running to run",
    );
    assert.equal(
      (await alice.retrieve("transactions", now)).memories[0].id,
      q.id,
      "Answer hits map to their preceding user",
    );
    assert.equal(
      (await alice.retrieve("transactions OR nonexistent", now)).total,
      1,
      "Lexical terms use OR",
    );
    assert.equal((await bob.retrieve("transactions", now)).total, 0);
    assert.equal(
      (await bob.retrieve("on November 3", now, "America/Los_Angeles")).total,
      0,
    );
    const expires = new Date(Date.now() + 60000).toISOString();
    assert.equal(await bob.acquireLease(c.id, "intruder", expires), false);
    const claims = await Promise.all([
      alice.acquireLease(c.id, "first", expires),
      alice.acquireLease(c.id, "second", expires),
    ]);
    assert.equal(
      claims.filter(Boolean).length,
      1,
      "Exactly one competing token acquires the lease",
    );
    const winner = claims[0] ? "first" : "second";
    await bob.releaseLease(c.id, winner);
    assert.equal(await alice.acquireLease(c.id, "third", expires), false);
    await alice.releaseLease(c.id, "wrong");
    assert.equal(await alice.acquireLease(c.id, "third", expires), false);
    await alice.releaseLease(c.id, winner);
    assert.equal(await alice.acquireLease(c.id, "third", expires), true);
    await db.query("UPDATE conversations SET lease_expires_at=$1 WHERE id=$2", [
      "2000-01-01T00:00:00Z",
      c.id,
    ]);
    await db.query(
      "UPDATE owner_limits SET lease_expires_at=$1 WHERE owner_id=$2",
      ["2000-01-01T00:00:00Z", "alice"],
    );
    assert.equal(
      await alice.acquireLease(c.id, "replacement", expires),
      true,
      "Expired lease permits atomic takeover",
    );
    await alice.releaseLease(c.id, "third");
    assert.equal(
      await alice.acquireLease(c.id, "blocked", expires),
      false,
      "Old holder cannot release replacement",
    );
    await alice.releaseLease(c.id, "replacement");
    assert.equal(
      await alice.acquireLease(c.id, "expired", "2000-01-01T00:00:00Z"),
      false,
    );
    await alice.addMessage(
      c.id,
      "user",
      "First unanswered",
      "2026-11-05T01:00:00Z",
    );
    await alice.addMessage(
      c.id,
      "user",
      "Second answered",
      "2026-11-05T01:01:00Z",
    );
    await alice.addMessage(
      c.id,
      "assistant",
      "Answer second",
      "2026-11-05T01:02:00Z",
    );
    const pairs = await alice.retrieve("on November 5", now);
    assert.equal(
      pairs.memories.find((m) => m.question === "First unanswered")?.answer,
      null,
    );
    assert.equal(
      pairs.memories.find((m) => m.question === "Second answered")?.answer,
      "Answer second",
    );
    const parallel = await alice.createConversation();
    await Promise.all([
      alice.addMessage(parallel.id, "user", "First title"),
      alice.addMessage(parallel.id, "user", "Second title"),
    ]);
    assert.equal(
      (await alice.conversation(parallel.id))?.title,
      (await alice.messages(parallel.id))[0].content,
      "Concurrent insert title is assigned once",
    );
    for (let i = 0; i < 14; i++)
      await alice.addMessage(c.id, "user", `bulk ${i}`, "2026-11-06T01:00:00Z");
    const bounded = await alice.retrieve("on November 6", now);
    assert.equal(bounded.total, 14);
    assert.equal(bounded.memories.length, 12);
    assert.equal(bounded.truncated, true);
    await db.exec(
      await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
    );
  } finally {
    await db.close();
  }
});

test("embedded PostgreSQL enforces one owner-wide active turn and sixty UTC-day admissions", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile } = await import("node:fs/promises");
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
    );
    const execute: QueryExecutor = async (sql, params) =>
      (await db.query<Record<string, unknown>>(sql, params)).rows;
    const a = new NeonMemory("", "limits-a", execute),
      sameOwner = new NeonMemory("", "limits-a", execute),
      b = new NeonMemory("", "limits-b", execute);
    const c1 = await a.createConversation(),
      c2 = await a.createConversation(),
      cb = await b.createConversation();
    const expiry = new Date(Date.now() + 60000).toISOString();
    const claims = await Promise.all([
      a.acquireLease(c1.id, "one", expiry),
      sameOwner.acquireLease(c2.id, "two", expiry),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(await b.acquireLease(cb.id, "other-owner", expiry), true);
    const winner = claims[0] ? c1 : c2,
      loser = claims[0] ? c2 : c1,
      token = claims[0] ? "one" : "two";
    await a.releaseLease(loser.id, token);
    assert.equal(await a.acquireLease(loser.id, "blocked", expiry), false);
    await a.releaseLease(winner.id, token);
    assert.equal(await a.acquireLease(loser.id, "next", expiry), true);
    await a.releaseLease(loser.id, "next");
    await assert.rejects(() => a.addMessage(cb.id, "user", "unauthorized"));
    assert.equal(await a.acquireLease(cb.id, "intruder", expiry), false);
    assert.equal(
      (
        await db.query<{ admitted_count: number }>(
          "SELECT admitted_count FROM owner_limits WHERE owner_id=$1",
          ["limits-a"],
        )
      ).rows[0].admitted_count,
      2,
      "Failed claims consume no admissions",
    );
    for (let i = 2; i < 60; i++) {
      assert.equal(
        await sameOwner.acquireLease(c1.id, `turn-${i}`, expiry),
        true,
      );
      await sameOwner.releaseLease(c1.id, `turn-${i}`);
    }
    assert.equal(
      await a.acquireLease(c2.id, "over-limit", expiry),
      false,
      "Released/aborted turns still count",
    );
    assert.equal(
      (
        await db.query<{ admitted_count: number }>(
          "SELECT admitted_count FROM owner_limits WHERE owner_id=$1",
          ["limits-a"],
        )
      ).rows[0].admitted_count,
      60,
    );
    await db.query(
      "UPDATE owner_limits SET admission_day=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date-1 WHERE owner_id=$1",
      ["limits-a"],
    );
    assert.equal(await a.acquireLease(c2.id, "new-day", expiry), true);
    assert.equal(
      (
        await db.query<{ admitted_count: number }>(
          "SELECT admitted_count FROM owner_limits WHERE owner_id=$1",
          ["limits-a"],
        )
      ).rows[0].admitted_count,
      1,
    );
    await db.query(
      "UPDATE owner_limits SET lease_expires_at=$1 WHERE owner_id=$2",
      ["2000-01-01T00:00:00Z", "limits-a"],
    );
    await db.query("UPDATE conversations SET lease_expires_at=$1 WHERE id=$2", [
      "2000-01-01T00:00:00Z",
      c2.id,
    ]);
    assert.equal(
      await sameOwner.acquireLease(c1.id, "after-expiry", expiry),
      true,
    );
    await a.releaseLease(c2.id, "new-day");
    assert.equal(await a.acquireLease(c2.id, "stale-release", expiry), false);
  } finally {
    await db.close();
  }
});

test("demo admission shares owner budget across conversations and rolls over by UTC day", async () => {
  const m = new DemoMemory(),
    c1 = await m.createConversation(),
    c2 = await m.createConversation();
  const original = Date.now;
  let now = Date.parse("2026-11-11T23:00:00Z");
  Date.now = () => now;
  try {
    const expires = () => new Date(now + 60000).toISOString();
    assert.equal(await m.acquireLease(c1.id, "first", expires()), true);
    assert.equal(await m.acquireLease(c2.id, "second", expires()), false);
    now += 60001;
    assert.equal(await m.acquireLease(c2.id, "replacement", expires()), true);
    await m.releaseLease(c1.id, "first");
    assert.equal(await m.acquireLease(c1.id, "blocked", expires()), false);
    await m.releaseLease(c2.id, "replacement");
    for (let i = 2; i < 60; i++) {
      assert.equal(await m.acquireLease(c1.id, `t-${i}`, expires()), true);
      await m.releaseLease(c1.id, `t-${i}`);
    }
    assert.equal(await m.acquireLease(c2.id, "limit", expires()), false);
    now = Date.parse("2026-11-12T00:00:00Z");
    assert.equal(await m.acquireLease(c2.id, "tomorrow", expires()), true);
  } finally {
    Date.now = original;
  }
});
