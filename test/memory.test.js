import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Memory } from "../src/memory.js";
const make = () => new Memory(":memory:");
test("persists conversations, messages and original evidence across restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "recall-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "memory.db");
  let db = new Memory(path);
  const c = db.createConversation();
  db.addMessage(
    c.id,
    "user",
    "Compare Neon and Supabase",
    "2026-11-03T09:00:00Z",
  );
  db.addMessage(
    c.id,
    "assistant",
    "Historical price was $19",
    "2026-11-03T09:00:01Z",
    [
      {
        id: "S1",
        url: "https://example.com/pricing",
        retrievedAt: "2026-11-03T09:00:01Z",
      },
    ],
  );
  db.close();
  db = new Memory(path);
  t.after(() => db.close());
  assert.equal(
    db.messages(c.id)[1].sources[0].retrievedAt,
    "2026-11-03T09:00:01Z",
  );
  assert.equal(db.conversations()[0].title, "Compare Neon and Supabase");
});
test("date recall returns exact local-date turns with paired answer", (t) => {
  const db = make();
  t.after(() => db.close());
  const c = db.createConversation();
  db.addMessage(c.id, "user", "Postgres hosting?", "2026-11-02T20:00:00Z");
  db.addMessage(c.id, "assistant", "Try Neon", "2026-11-02T20:00:01Z");
  db.addMessage(c.id, "user", "Other topic", "2026-11-03T20:00:00Z");
  const found = db.retrieve(
    "What did I ask on 3 November?",
    new Date("2026-11-11T00:00:00Z"),
    "Asia/Kolkata",
  );
  assert.equal(found.date.day, "2026-11-03");
  assert.equal(found.memories.length, 1);
  assert.equal(found.memories[0].question, "Postgres hosting?");
  assert.equal(found.memories[0].answer, "Try Neon");
});
test("lexical retrieval finds old topic and does not invent memory for empty dates", (t) => {
  const db = make();
  t.after(() => db.close());
  const c = db.createConversation();
  db.addMessage(
    c.id,
    "user",
    "We shortlisted Salesforce and HubSpot CRM",
    "2025-06-01T00:00:00Z",
  );
  db.addMessage(
    c.id,
    "assistant",
    "Our two CRM choices",
    "2025-06-01T00:00:01Z",
  );
  assert.equal(
    db.retrieve("What was our CRM shortlist?", new Date("2026-11-11"), "UTC")
      .memories[0].question,
    "We shortlisted Salesforce and HubSpot CRM",
  );
  assert.equal(
    db.retrieve("What did I ask on 3 November?", new Date("2026-11-11"), "UTC")
      .memories.length,
    0,
  );
});
test("FTS syntax is data and recent context is bounded", (t) => {
  const db = make();
  t.after(() => db.close());
  const c = db.createConversation();
  for (let i = 0; i < 30; i++)
    db.addMessage(c.id, "user", `question ${i}`, "2026-11-11T00:00:00Z");
  assert.doesNotThrow(() =>
    db.retrieve('" OR * NEAR () --', new Date(), "UTC"),
  );
  assert.equal(db.messages(c.id, 4).length, 4);
  assert.equal(db.messages("missing").length, 0);
});
test("today as a freshness target does not hide an older shortlist", (t) => {
  const db = make();
  t.after(() => db.close());
  const c = db.createConversation();
  db.addMessage(
    c.id,
    "user",
    "We shortlisted HubSpot and Salesforce CRM",
    "2026-11-09T10:00:00Z",
  );
  db.addMessage(
    c.id,
    "assistant",
    "Both fit your sales team",
    "2026-11-09T10:00:01Z",
  );
  const found = db.retrieve(
    "Have any of our shortlisted CRMs changed pricing today?",
    new Date("2026-11-11T12:00:00Z"),
    "UTC",
  );
  assert.equal(found.date, null);
  assert.equal(
    found.memories[0].question,
    "We shortlisted HubSpot and Salesforce CRM",
  );
  assert.equal(
    db.retrieve(
      "What did I ask today?",
      new Date("2026-11-11T12:00:00Z"),
      "UTC",
    ).date.day,
    "2026-11-11",
  );
});
test("a discussed shortlist rechecked today still retrieves its older record", (t) => {
  const db = make();
  t.after(() => db.close());
  const c = db.createConversation();
  db.addMessage(c.id, "user", "Our CRM shortlist", "2026-11-09T10:00:00Z");
  db.addMessage(
    c.id,
    "assistant",
    "HubSpot and Salesforce",
    "2026-11-09T10:00:01Z",
  );
  const found = db.retrieve(
    "Is the CRM shortlist we discussed still correct today?",
    new Date("2026-11-11T12:00:00Z"),
    "UTC",
  );
  assert.equal(found.date, null);
  assert.equal(found.memories.length, 1);
});
