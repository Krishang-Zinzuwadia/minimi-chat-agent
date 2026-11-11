import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL is required. Set it privately for an existing Neon database, then run npm run db:migrate.",
    );
  const schema = await readFile(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const sql = neon(url);
  await sql.transaction(
    statements.map((statement) => sql.query(statement, [])),
  );
  console.log("Recall database schema migration completed.");
}
main().catch(() => {
  console.error(
    process.env.DATABASE_URL
      ? "Database migration failed. Check database connectivity and schema permissions. Credentials are not logged."
      : "DATABASE_URL is required. Set it privately for an existing Neon database, then run npm run db:migrate.",
  );
  process.exitCode = 1;
});
