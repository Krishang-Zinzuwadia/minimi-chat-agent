import { randomUUID } from "node:crypto";
import type {
  Conversation,
  Message,
  Source,
  MemoryContext,
  MemoryStore,
  RecentQuestion,
} from "./types";
import { lexicalTerms, localDay, retrievalDate } from "./temporal";
import {
  MAX_SUGGESTION_QUESTIONS,
  MAX_SUGGESTION_QUESTION_LENGTH,
} from "./suggestions";
/** Temporary process-local demo only. Never used as fallback for a failed live database. */
export class DemoMemory implements MemoryStore {
  private chats = new Map<string, Conversation>();
  private entries: Message[] = [];
  private nextId = 1;
  private leases = new Map<string, { token: string; expiresAt: number }>();
  private admissionDay = "";
  private admittedCount = 0;
  private ownerLease: {
    conversationId: string;
    token: string;
    expiresAt: number;
  } | null = null;
  async createConversation(
    now = new Date().toISOString(),
  ): Promise<Conversation> {
    if (this.chats.size >= 100)
      throw new Error("Temporary demo conversation limit reached");
    const c = {
      id: randomUUID(),
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
    };
    this.chats.set(c.id, c);
    return { ...c };
  }
  async conversation(id: string) {
    const c = this.chats.get(id);
    return c ? { ...c } : null;
  }
  async conversations() {
    return [...this.chats.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((c) => ({ ...c }));
  }
  async messages(id: string, limit = 500) {
    return structuredClone(
      this.entries
        .filter((m) => m.conversationId === id)
        .slice(-Math.min(500, Math.max(1, Math.trunc(limit) || 1))),
    );
  }
  async recentQuestions(
    limit = MAX_SUGGESTION_QUESTIONS,
  ): Promise<RecentQuestion[]> {
    return this.entries
      .filter((message) => message.role === "user")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .slice(
        0,
        Math.min(MAX_SUGGESTION_QUESTIONS, Math.max(1, Math.trunc(limit) || 1)),
      )
      .map(({ id, content, createdAt }) => ({
        id,
        content:
          content.length <= MAX_SUGGESTION_QUESTION_LENGTH ? content : "",
        createdAt,
      }));
  }
  async addMessage(
    conversationId: string,
    role: Message["role"],
    content: string,
    createdAt = new Date().toISOString(),
    sources: Source[] = [],
    metadata: Record<string, unknown> = {},
  ): Promise<Message> {
    const c = this.chats.get(conversationId);
    if (!c) throw new Error("Conversation not found");
    if (role !== "user" && role !== "assistant")
      throw new Error("Invalid message role");
    if (this.entries.length >= 5000)
      throw new Error("Temporary demo message limit reached");
    const m = {
      id: this.nextId++,
      conversationId,
      role,
      content,
      createdAt,
      sources: structuredClone(sources),
      metadata: structuredClone(metadata),
    };
    this.entries.push(m);
    if (createdAt > c.updatedAt) c.updatedAt = createdAt;
    if (c.title === "New conversation" && role === "user")
      c.title = content.slice(0, 70);
    return structuredClone(m);
  }
  async acquireLease(id: string, token: string, expiresAt: string) {
    const now = Date.now(),
      expires = Date.parse(expiresAt),
      existing = this.leases.get(id),
      day = new Date(now).toISOString().slice(0, 10);
    if (
      !token ||
      !this.chats.has(id) ||
      !Number.isFinite(expires) ||
      expires <= now ||
      (existing && existing.expiresAt > now) ||
      (this.ownerLease && this.ownerLease.expiresAt > now)
    )
      return false;
    if (this.admissionDay === day && this.admittedCount >= 60) return false;
    this.admittedCount = this.admissionDay === day ? this.admittedCount + 1 : 1;
    this.admissionDay = day;
    this.ownerLease = { conversationId: id, token, expiresAt: expires };
    this.leases.set(id, { token, expiresAt: expires });
    return true;
  }
  async releaseLease(id: string, token: string) {
    if (this.leases.get(id)?.token === token) this.leases.delete(id);
    if (
      this.ownerLease?.conversationId === id &&
      this.ownerLease.token === token
    )
      this.ownerLease = null;
  }
  async retrieve(
    query: string,
    now = new Date(),
    timezone = "UTC",
  ): Promise<MemoryContext> {
    const date = retrievalDate(query, now, timezone),
      terms = lexicalTerms(query);
    let users: Message[] = [];
    if (date)
      users = this.entries.filter(
        (m) =>
          m.role === "user" && localDay(m.createdAt, timezone) === date.day,
      );
    else {
      const found = new Map<number, Message>();
      for (const hit of this.entries) {
        if (!terms.some((t) => hit.content.toLowerCase().includes(t))) continue;
        const u =
          hit.role === "user"
            ? hit
            : [...this.entries]
                .reverse()
                .find(
                  (m) =>
                    m.conversationId === hit.conversationId &&
                    m.id < hit.id &&
                    m.role === "user",
                );
        if (u) found.set(u.id, u);
      }
      users = [...found.values()];
    }
    users.sort((a, b) => b.id - a.id);
    return {
      date,
      total: users.length,
      truncated: users.length > 12,
      memories: users.slice(0, 12).map((u) => {
        const next = this.entries.find(
            (m) => m.conversationId === u.conversationId && m.id > u.id,
          ),
          a = next?.role === "assistant" ? next : null;
        return {
          id: u.id,
          conversationId: u.conversationId,
          askedAt: u.createdAt,
          localDate: localDay(u.createdAt, timezone),
          question: u.content.slice(0, 5000),
          answer: a?.content.slice(0, 7000) || null,
          answeredAt: a?.createdAt || null,
          sources: structuredClone(a?.sources || []).map((s) => ({
            ...s,
            historical: true,
          })),
        };
      }),
    };
  }
}
const owners = new Map<string, DemoMemory>();
export function getDemoMemory(owner: string): DemoMemory {
  if (!owner || owner.length > 256)
    throw new Error("A valid memory owner is required");
  let m = owners.get(owner);
  if (!m) {
    if (owners.size >= 100) owners.delete(owners.keys().next().value!);
    m = new DemoMemory();
    owners.set(owner, m);
  }
  return m;
}
