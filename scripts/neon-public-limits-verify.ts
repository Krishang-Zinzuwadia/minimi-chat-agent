import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { PublicLimits } from "../lib/public-limits";
const url = process.env.DATABASE_URL;
if (!url || process.env.VERIFY_ISOLATED_BRANCH !== "yes")
  throw Error("Explicit isolated branch verification required");
const sql = neon(url);
const limits = new PublicLimits(url);
const prefix = "verification:" + randomUUID();
async function count(scope: string) {
  const rows = await sql.query(
    "SELECT daily_count,total_count FROM public_limits WHERE scope=$1",
    [scope],
  );
  return rows[0];
}
const concurrent = prefix + ":parallel";
const attempts = await Promise.allSettled(
  Array.from({ length: 30 }, () => limits.take(concurrent, 7, 20)),
);
assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 7);
assert.equal(attempts.filter((x) => x.status === "rejected").length, 23);
assert.deepEqual(await count(concurrent), { daily_count: 7, total_count: 7 });
const lifetime = prefix + ":lifetime";
for (let i = 0; i < 3; i++) await limits.take(lifetime, 10, 3);
await assert.rejects(limits.take(lifetime, 10, 3));
await sql.query(
  "UPDATE public_limits SET day=((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date-1) WHERE scope=$1",
  [lifetime],
);
await assert.rejects(limits.take(lifetime, 10, 3));
assert.deepEqual(await count(lifetime), { daily_count: 3, total_count: 3 });
const rollover = prefix + ":rollover";
await limits.take(rollover, 1, 3);
await assert.rejects(limits.take(rollover, 1, 3));
await sql.query(
  "UPDATE public_limits SET day=((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date-1) WHERE scope=$1",
  [rollover],
);
await limits.take(rollover, 1, 3);
assert.deepEqual(await count(rollover), { daily_count: 1, total_count: 2 });
await assert.rejects(limits.take(rollover, 1, 3));
await limits.take(prefix + ":independent-owner", 1, 1);
assert.deepEqual(await count(prefix + ":independent-owner"), {
  daily_count: 1,
  total_count: 1,
});
console.log(
  "PASS: isolated Neon atomic concurrency (7/30), daily ceiling, UTC rollover, lifetime ceiling across rollover, independent scopes.",
);
console.log("Synthetic verification rows retained; production untouched.");
