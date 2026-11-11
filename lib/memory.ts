import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import type {
  Conversation,
  Message,
  Source,
  MemoryContext,
  MemoryStore,
} from "./types";
import { localDay, retrievalDate, lexicalTerms } from "./temporal";
export type QueryExecutor = (
  sql: string,
  parameters: unknown[],
) => Promise<Record<string, unknown>[]>;
const iso = (v: unknown) => new Date(String(v)).toISOString();
const conversationRow = (r: Record<string, unknown>): Conversation => ({
  id: String(r.id),
  title: String(r.title),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
export function safeId(v: unknown): number {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Message ID outside safe range");
  return id;
}
function messageRow(r: Record<string, unknown>): Message {
  return {
    id: safeId(r.id),
    conversationId: String(r.conversation_id),
    role: r.role as Message["role"],
    content: String(r.content),
    createdAt: iso(r.created_at),
    sources: (r.sources || []) as Source[],
    metadata: (r.metadata || {}) as Record<string, unknown>,
  };
}
export class NeonMemory implements MemoryStore {
  private readonly query: QueryExecutor;
  constructor(
    databaseUrl: string,
    private readonly ownerId: string,
    queryExecutor?: QueryExecutor,
  ) {
    if (!ownerId || ownerId.length > 256)
      throw new Error("A valid memory owner is required");
    if (queryExecutor) this.query = queryExecutor;
    else {
      const sql = neon(databaseUrl);
      this.query = async (text, parameters) =>
        (await sql.query(text, parameters)) as Record<string, unknown>[];
    }
  }
  async createConversation(
    now = new Date().toISOString(),
  ): Promise<Conversation> {
    const rows = await this.query(
      "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES($1,$2,$3,$4,$4) RETURNING *",
      [randomUUID(), this.ownerId, "New conversation", now],
    );
    return conversationRow(rows[0]);
  }
  async conversation(id: string): Promise<Conversation | null> {
    const rows = await this.query(
      "SELECT * FROM conversations WHERE owner_id=$1 AND id=$2",
      [this.ownerId, id],
    );
    return rows[0] ? conversationRow(rows[0]) : null;
  }
  async conversations(): Promise<Conversation[]> {
    return (
      await this.query(
        "SELECT * FROM conversations WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 100",
        [this.ownerId],
      )
    ).map(conversationRow);
  }
  async messages(id: string, limit = 500): Promise<Message[]> {
    return (
      await this.query(
        "SELECT * FROM (SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.owner_id=$1 AND c.id=$2 ORDER BY m.id DESC LIMIT $3) recent ORDER BY id",
        [this.ownerId, id, Math.min(500, Math.max(1, Math.trunc(limit) || 1))],
      )
    ).map(messageRow);
  }
  async addMessage(
    conversationId: string,
    role: Message["role"],
    content: string,
    createdAt = new Date().toISOString(),
    sources: Source[] = [],
    metadata: Record<string, unknown> = {},
  ): Promise<Message> {
    if (role !== "user" && role !== "assistant")
      throw new Error("Invalid message role");
    // UPDATE locks the owned conversation before insertion; concurrent first messages cannot race its title.
    const rows = await this.query(
      `WITH owned AS (
   UPDATE conversations SET updated_at=GREATEST(updated_at,$5::timestamptz),
    title=CASE WHEN title='New conversation' AND $3='user' THEN left($4,70) ELSE title END
   WHERE owner_id=$1 AND id=$2 RETURNING id
  ) INSERT INTO messages(conversation_id,role,content,created_at,sources,metadata)
    SELECT id,$3,$4,$5::timestamptz,$6::jsonb,$7::jsonb FROM owned RETURNING *`,
      [
        this.ownerId,
        conversationId,
        role,
        content,
        createdAt,
        JSON.stringify(sources),
        JSON.stringify(metadata),
      ],
    );
    if (!rows[0]) throw new Error("Conversation not found");
    return messageRow(rows[0]);
  }
  async acquireLease(
    id: string,
    token: string,
    expiresAt: string,
  ): Promise<boolean> {
    if (!token) throw new Error("Lease token required");
    // Lock the requested owned conversation before admitting the owner. One statement is
    // atomic across worker isolates; an invalid/busy conversation never spends admission.
    const rows = await this.query(
      `WITH target AS (
   SELECT id FROM conversations WHERE owner_id=$1 AND id=$2
    AND $4::timestamptz>CURRENT_TIMESTAMP
    AND (lease_token IS NULL OR lease_expires_at<=CURRENT_TIMESTAMP) FOR UPDATE
  ), admission AS (
   INSERT INTO owner_limits(owner_id,conversation_id,lease_token,lease_expires_at,admission_day,admitted_count)
   SELECT $1,id,$3,$4::timestamptz,(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,1 FROM target
   ON CONFLICT(owner_id) DO UPDATE SET conversation_id=EXCLUDED.conversation_id,
    lease_token=EXCLUDED.lease_token,lease_expires_at=EXCLUDED.lease_expires_at,
    admission_day=EXCLUDED.admission_day,
    admitted_count=CASE WHEN owner_limits.admission_day=EXCLUDED.admission_day THEN owner_limits.admitted_count+1 ELSE 1 END
   WHERE (owner_limits.lease_token IS NULL OR owner_limits.lease_expires_at<=CURRENT_TIMESTAMP)
    AND (owner_limits.admission_day<>EXCLUDED.admission_day OR owner_limits.admitted_count<60)
   RETURNING conversation_id
  ) UPDATE conversations SET lease_token=$3,lease_expires_at=$4::timestamptz
    FROM admission WHERE conversations.id=admission.conversation_id AND conversations.owner_id=$1 RETURNING conversations.id`,
      [this.ownerId, id, token, expiresAt],
    );
    return rows.length > 0;
  }
  async releaseLease(id: string, token: string): Promise<void> {
    await this.query(
      `WITH released AS (
  UPDATE conversations SET lease_token=NULL,lease_expires_at=NULL
   WHERE owner_id=$1 AND id=$2 AND lease_token=$3 RETURNING owner_id
 ) UPDATE owner_limits SET conversation_id=NULL,lease_token=NULL,lease_expires_at=NULL
   WHERE owner_id=$1 AND conversation_id=$2 AND lease_token=$3 AND owner_id IN (SELECT owner_id FROM released)`,
      [this.ownerId, id, token],
    );
  }
  async retrieve(
    query: string,
    now = new Date(),
    timezone = "UTC",
  ): Promise<MemoryContext> {
    const date = retrievalDate(query, now, timezone),
      terms = lexicalTerms(query);
    if (!date && !terms.length)
      return { date, memories: [], total: 0, truncated: false };
    // Both branches produce owned user messages. Lexical matches on answers map to their preceding user.
    const dateSql = `SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.owner_id=$1 AND m.role='user' AND (m.created_at AT TIME ZONE $3)::date=$2::date`;
    const lexicalSql = `SELECT DISTINCT u.* FROM messages hit JOIN conversations c ON c.id=hit.conversation_id
   JOIN LATERAL (SELECT m.* FROM messages m WHERE m.conversation_id=c.id AND m.role='user' AND m.id<=hit.id ORDER BY m.id DESC LIMIT 1) u ON true
   WHERE c.owner_id=$1 AND hit.search_vector @@ websearch_to_tsquery('english',$2)`;
    const rows = await this.query(
      `WITH matched AS (${date ? dateSql : lexicalSql}), limited AS (SELECT *,count(*) OVER() AS total FROM matched ORDER BY id DESC LIMIT 12)
   SELECT u.*,a.content AS answer,a.created_at AS answered_at,a.sources AS answer_sources FROM limited u
   LEFT JOIN LATERAL (SELECT n.* FROM messages n WHERE n.conversation_id=u.conversation_id AND n.id>u.id ORDER BY n.id LIMIT 1) a ON a.role='assistant' ORDER BY u.id DESC`,
      date
        ? [this.ownerId, date.day, timezone]
        : [this.ownerId, terms.join(" OR ")],
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return {
      date,
      total,
      truncated: total > rows.length,
      memories: rows.map((r) => ({
        id: safeId(r.id),
        conversationId: String(r.conversation_id),
        askedAt: iso(r.created_at),
        localDate: localDay(iso(r.created_at), timezone),
        question: String(r.content).slice(0, 5000),
        answer: r.answer == null ? null : String(r.answer).slice(0, 7000),
        answeredAt: r.answered_at ? iso(r.answered_at) : null,
        sources: ((r.answer_sources || []) as Source[]).map((s) => ({
          ...s,
          historical: true,
        })),
      })),
    };
  }
}
export { NeonMemory as PostgresMemory };
