import test from "node:test";
import assert from "node:assert/strict";
import { localDay, resolveDate, retrievalDate } from "../lib/temporal";
const now = new Date("2026-11-11T18:00:00Z");
test("local calendar dates respect timezone midnight", () => {
  assert.equal(localDay("2026-11-11T20:00:00Z", "Asia/Kolkata"), "2026-11-12");
});
test("resolves challenge examples to calendar days, not elapsed 24h windows", () => {
  assert.equal(
    resolveDate("What did I ask on 3 November?", now, "UTC")?.day,
    "2026-11-03",
  );
  assert.equal(
    resolveDate("Last Tuesday I asked about Postgres", now, "UTC")?.day,
    "2026-11-10",
  );
  assert.equal(
    resolveDate("On Monday we shortlisted 5 CRMs", now, "UTC")?.day,
    "2026-11-09",
  );
});
test("same weekday means previous occurrence for last, today otherwise", () => {
  assert.equal(resolveDate("last Wednesday", now, "UTC")?.day, "2026-11-04");
  assert.equal(resolveDate("on Wednesday", now, "UTC")?.day, "2026-11-11");
});
test("missing year chooses most recent past date, including across years", () => {
  assert.equal(
    resolveDate("on 30 December", new Date("2026-01-03T00:00:00Z"), "UTC")?.day,
    "2025-12-30",
  );
  assert.equal(
    resolveDate("on November 3, 2025", now, "UTC")?.day,
    "2025-11-03",
  );
});
test("invalid dates and ambiguous numeric dates are not guessed", () => {
  assert.equal(resolveDate("on 31 February 2026", now, "UTC"), null);
  assert.equal(resolveDate("on 03/04", now, "UTC"), null);
  assert.equal(resolveDate("ordinary question", now, "UTC"), null);
});
test("yesterday is a local day across DST changes", () => {
  assert.equal(
    resolveDate(
      "yesterday",
      new Date("2026-11-02T05:15:00Z"),
      "America/New_York",
    )?.day,
    "2026-11-01",
  );
  assert.equal(resolveDate("2025-02-28", now, "UTC")?.day, "2025-02-28");
});
test("Monday CRM product name is not interpreted as a calendar reference", () => {
  assert.equal(resolveDate("Compare Monday CRM and HubSpot", now, "UTC"), null);
});
test("recheck dates do not replace the date of the recalled question", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  assert.equal(
    retrievalDate(
      "What did I ask you yesterday? Is that advice still correct as of 11 November?",
      now,
      "UTC",
    )?.day,
    "2026-11-10",
  );
  assert.equal(
    retrievalDate(
      "What did I ask you last Tuesday, and is it still correct as of 2026-11-11?",
      now,
      "UTC",
    )?.day,
    "2026-11-10",
  );
  assert.equal(
    retrievalDate(
      "As of 11 November, is it still correct? We discussed Postgres on Monday.",
      now,
      "UTC",
    )?.day,
    "2026-11-09",
  );
});
