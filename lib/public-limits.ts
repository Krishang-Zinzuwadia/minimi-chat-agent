import { neon } from "@neondatabase/serverless";
import { AppError } from "./errors";
import type { QueryExecutor } from "./memory";

// Hard ceilings, not user-controlled knobs. Attempts are charged before work and
// never refunded, including errors/cancellations. Global lifetime caps prevent
// cookie resets or daily rollover from creating an unbounded provider bill.
export class PublicLimits {
  private query: QueryExecutor;
  constructor(databaseUrl: string, executor?: QueryExecutor) {
    const sql = executor ? null : neon(databaseUrl);
    this.query =
      executor ?? (async (text, params) => await sql!.query(text, params));
  }
  async take(scope: string, daily: number, lifetime: number): Promise<void> {
    const rows = await this.query(
      `INSERT INTO public_limits(scope, day, daily_count, total_count)
      VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1, 1)
      ON CONFLICT(scope) DO UPDATE SET
        day=EXCLUDED.day,
        daily_count=CASE WHEN public_limits.day=EXCLUDED.day THEN public_limits.daily_count+1 ELSE 1 END,
        total_count=public_limits.total_count+1
      WHERE public_limits.total_count<$3 AND
        (public_limits.day<>EXCLUDED.day OR public_limits.daily_count<$2)
      RETURNING scope`,
      [scope, daily, lifetime],
    );
    if (!rows.length)
      throw new AppError(
        429,
        "The public demo usage limit has been reached. Please try again later.",
      );
  }
  async admit(
    owner: string,
    kind: "api" | "chat" | "model" | "search",
  ): Promise<void> {
    const caps = {
      api: [3000, 30000, 120],
      chat: [30, 300, 6],
      model: [60, 600, 12],
      search: [60, 600, 12],
    } as const;
    const [daily, lifetime, visitor] = caps[kind];
    // Global first: a new visitor cannot allocate unlimited durable rows.
    await this.take(`global:${kind}`, daily, lifetime);
    await this.take(`${owner}:${kind}`, visitor, visitor * 30);
  }
}
