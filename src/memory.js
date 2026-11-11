import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { localDay, resolveDate } from "./time.js";

const decode = (row) =>
  row
    ? {
        ...row,
        sources: JSON.parse(row.sources || "[]"),
        metadata: JSON.parse(row.metadata || "{}"),
      }
    : null;
const stopwords = new Set(
  "what did i you we our on at the a an is are was were to about any has have had and or it them they that this today since last asked ask still correct changed pricing".split(
    " ",
  ),
);

export class Memory {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, title TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, conversationId TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, createdAt TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]', metadata TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversationId,id);
      CREATE INDEX IF NOT EXISTS messages_time ON messages(createdAt);
      CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(content, content='messages', content_rowid='id', tokenize='porter unicode61');
      CREATE TRIGGER IF NOT EXISTS messages_insert AFTER INSERT ON messages BEGIN INSERT INTO message_search(rowid,content) VALUES(new.id,new.content); END;`);
  }
  close() {
    this.db.close();
  }
  createConversation(now = new Date().toISOString()) {
    const c = {
      id: randomUUID(),
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare("INSERT INTO conversations VALUES(?,?,?,?)")
      .run(c.id, c.title, c.createdAt, c.updatedAt);
    return c;
  }
  conversation(id) {
    return (
      this.db.prepare("SELECT * FROM conversations WHERE id=?").get(id) || null
    );
  }
  conversations() {
    return this.db
      .prepare("SELECT * FROM conversations ORDER BY updatedAt DESC LIMIT 100")
      .all();
  }
  messages(id, limit = 500) {
    return this.db
      .prepare(
        "SELECT * FROM (SELECT * FROM messages WHERE conversationId=? ORDER BY id DESC LIMIT ?) ORDER BY id",
      )
      .all(id, limit)
      .map(decode);
  }
  addMessage(
    conversationId,
    role,
    content,
    createdAt = new Date().toISOString(),
    sources = [],
    metadata = {},
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(
          "INSERT INTO messages(conversationId,role,content,createdAt,sources,metadata) VALUES(?,?,?,?,?,?)",
        )
        .run(
          conversationId,
          role,
          content,
          createdAt,
          JSON.stringify(sources),
          JSON.stringify(metadata),
        );
      this.db
        .prepare(
          "UPDATE conversations SET updatedAt=?, title=CASE WHEN title='New conversation' AND ?='user' THEN ? ELSE title END WHERE id=?",
        )
        .run(createdAt, role, content.slice(0, 70), conversationId);
      this.db.exec("COMMIT");
      return decode(
        this.db
          .prepare("SELECT * FROM messages WHERE id=?")
          .get(result.lastInsertRowid),
      );
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  /** Retrieval is internal application state, not a second model-callable tool. */
  retrieve(query, now = new Date(), timezone = "UTC") {
    let date = resolveDate(query, now, timezone);
    // "today" in a recheck describes the new observation, not the old conversation.
    if (
      date?.expression === "today" &&
      !/\bwhat (?:did|have|were|was|are) (?:i|we|you)\b.*\btoday\b|\btoday[, ]+(?:i|we) (?:asked|discussed|said|talked)\b|\b(?:ask|asked|discussed|said|talked)(?: (?:you|me))? today\b/i.test(
        query,
      )
    )
      date = null;
    let rows = [];
    if (date) {
      const anchor = new Date(`${date.day}T00:00:00Z`);
      const lower = new Date(+anchor - 86400000).toISOString();
      const upper = new Date(+anchor + 172800000).toISOString();
      rows = this.db
        .prepare(
          "SELECT * FROM messages WHERE role='user' AND createdAt>=? AND createdAt<? ORDER BY id",
        )
        .all(lower, upper)
        .filter((row) => localDay(row.createdAt, timezone) === date.day);
    } else {
      const terms = [
        ...new Set(
          (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
            (x) => x.length > 2 && !stopwords.has(x),
          ),
        ),
      ].slice(0, 12);
      if (terms.length) {
        const hits = this.db
          .prepare(
            "SELECT m.* FROM message_search f JOIN messages m ON m.id=f.rowid WHERE message_search MATCH ? ORDER BY rank LIMIT 24",
          )
          .all(terms.map((x) => `"${x}"`).join(" OR "));
        const seen = new Set();
        for (const hit of hits) {
          const user =
            hit.role === "user"
              ? hit
              : this.db
                  .prepare(
                    "SELECT * FROM messages WHERE conversationId=? AND id<? AND role='user' ORDER BY id DESC LIMIT 1",
                  )
                  .get(hit.conversationId, hit.id);
          if (user && !seen.has(user.id)) {
            rows.push(user);
            seen.add(user.id);
          }
        }
      }
    }
    const total = rows.length;
    const memories = rows.slice(0, 12).map((user) => {
      const next = decode(
        this.db
          .prepare(
            "SELECT * FROM messages WHERE conversationId=? AND id>? ORDER BY id LIMIT 1",
          )
          .get(user.conversationId, user.id),
      );
      const answer = next?.role === "assistant" ? next : null;
      return {
        id: user.id,
        conversationId: user.conversationId,
        askedAt: user.createdAt,
        localDate: localDay(user.createdAt, timezone),
        question: user.content.slice(0, 5000),
        answer: answer?.content.slice(0, 7000) || null,
        answeredAt: answer?.createdAt || null,
        sources: answer?.sources || [],
      };
    });
    return { date, memories, total, truncated: total > memories.length };
  }
}
