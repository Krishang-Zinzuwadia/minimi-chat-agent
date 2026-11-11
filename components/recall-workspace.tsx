"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Globe2,
  History,
  Layers3,
  Menu,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createEventParser, safeSourceUrl } from "../lib/client/stream";

import { discardProvisionalTurn } from "../lib/client/recovery";
import { apiErrorMessage } from "../lib/client/request";
import type { Conversation, Message, Source, Status } from "../lib/types";
const starters = [
  {
    icon: Globe2,
    label: "Explore something new",
    prompt: "What are the most important developments in AI agents this week?",
  },
  {
    icon: History,
    label: "See what changed",
    prompt:
      "How has the outlook for renewable energy changed over the last year?",
  },
  {
    icon: Layers3,
    label: "Go a little deeper",
    prompt:
      "Compare the trade-offs of serverless and traditional databases for a small team.",
  },
];
const date = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "Date unavailable"
    : d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
};
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = apiErrorMessage(body, message);
    } catch {}
    throw new Error(message);
  }
  return (await response.json()) as T;
}
function SourceCard({ source }: { source: Source }) {
  const url = safeSourceUrl(source.url);
  let host = "Source";
  if (url) host = new URL(url).hostname.replace(/^www\./, "");
  const content = (
    <>
      <div className="source-top">
        <span className={`source-id ${source.historical ? "historical" : ""}`}>
          {source.id}
        </span>
        <span>{source.historical ? "From memory" : "Current research"}</span>
        {url ? <ArrowUpRight size={14} /> : null}
      </div>
      <h4>{source.title}</h4>
      <div className="source-host">
        <Globe2 size={12} />
        {host}
      </div>
      <p>Retrieved {date(source.retrievedAt)}</p>
      {source.publishedAt ? <p>Published {date(source.publishedAt)}</p> : null}
    </>
  );
  return url ? (
    <a
      className="source-card"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {content}
    </a>
  ) : (
    <div className="source-card">{content}</div>
  );
}
function Markdown({ message }: { message: Message }) {
  const known = new Map(
    message.sources.flatMap((s) => {
      const u = safeSourceUrl(s.url);
      return u ? [[u, s] as const] : [];
    }),
  );
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const url = href ? safeSourceUrl(href) : null;
          return url && known.has(url) ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {children}
              <ArrowUpRight size={12} />
            </a>
          ) : (
            <span className="unverified-link">{children}</span>
          );
        },
        img: ({ alt }) => <span>{alt}</span>,
        table: ({ children }) => (
          <div className="table-scroll">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {message.content}
    </ReactMarkdown>
  );
}

export function RecallWorkspace() {
  const [status, setStatus] = useState<Status | null>(null),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [phase, setPhase] = useState(""),
    [error, setError] = useState(""),
    [rail, setRail] = useState(true),
    [mobileMenu, setMobileMenu] = useState(false),
    [mobileEvidence, setMobileEvidence] = useState(false),
    [help, setHelp] = useState(false);
  const reduced = useReducedMotion();
  const generation = useRef<AbortController | null>(null),
    load = useRef<AbortController | null>(null),
    lock = useRef(false),
    end = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const helpTrigger = useRef<HTMLButtonElement | null>(null);
  const navigationTrigger = useRef<HTMLButtonElement | null>(null);
  const evidenceTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      request<Status>("/api/status", { signal: controller.signal }).then(
        (s) => {
          if (!controller.signal.aborted) setStatus(s);
        },
      ),
      request<Conversation[]>("/api/conversations", {
        signal: controller.signal,
      }).then((c) => {
        if (!controller.signal.aborted) setConversations(c);
      }),
    ])
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to load your workspace.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      load.current?.abort();
      generation.current?.abort();
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({
      behavior: reduced ? "instant" : "smooth",
      block: "end",
    });
  }, [messages, phase, reduced]);
  const latest = [...messages].reverse().find((m) => m.role === "assistant");
  const sources = latest?.sources || [];
  const memoryCount =
    typeof latest?.metadata?.memoryCount === "number"
      ? latest.metadata.memoryCount
      : 0;
  async function openConversation(id: string) {
    if (lock.current) return;
    load.current?.abort();
    const controller = new AbortController();
    load.current = controller;
    setLoading(true);
    setError("");
    setMobileMenu(false);
    try {
      const result = await request<{
        conversation: Conversation;
        messages: Message[];
      }>(`/api/conversations/${id}`, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setSelected(id);
        setMessages(result.messages);
        setDraft("");
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Unable to load conversation.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function newConversation() {
    if (lock.current) return;
    load.current?.abort();
    setLoading(false);
    setSelected(null);
    setMessages([]);
    setDraft("");
    setError("");
    setMobileMenu(false);
    input.current?.focus();
  }
  async function send() {
    const text = draft.trim();
    if (!text || lock.current || loading || status?.mode === "setup" || !status)
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    setPhase("Connecting the dots…");
    const controller = new AbortController();
    generation.current = controller;
    const provisional = -Date.now();
    let complete = false;
    let activeConversationId = selected;
    let chatAttempted = false;
    let rejectedResponse = false;
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      let id = selected;
      if (!id) {
        const conversation = await request<Conversation>("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: controller.signal,
        });
        id = conversation.id;
        setSelected(id);
        setConversations((c) => [conversation, ...c]);
      }
      const conversationId = id;
      activeConversationId = id;
      setDraft("");
      setMessages((m) => [
        ...m,
        {
          id: provisional,
          conversationId,
          role: "user",
          content: text,
          createdAt: new Date().toISOString(),
          sources: [],
          metadata: {},
        },
        {
          id: provisional - 1,
          conversationId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          sources: [],
          metadata: {},
        },
      ]);
      chatAttempted = true;
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: text,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: controller.signal,
      });
      rejectedResponse = !response.ok;
      if (!response.ok || !response.body) {
        let detail = "Unable to start research. Please try again.";
        try {
          const body = await response.json();
          detail = apiErrorMessage(body, detail);
        } catch {}
        throw new Error(detail);
      }
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      streamReader = reader;
      const parser = createEventParser(({ event, data }) => {
        const payload = data as {
          message?: string | Message;
          text?: string;
          count?: number;
          metrics?: { durationMs: number; searches: number };
        };
        if (event === "status" && typeof payload.message === "string")
          setPhase(payload.message);
        if (event === "memory")
          setMessages((m) =>
            m.map((item) =>
              item.id === provisional - 1
                ? {
                    ...item,
                    metadata: { ...item.metadata, memoryCount: payload.count },
                  }
                : item,
            ),
          );
        if (event === "delta" && payload.text)
          setMessages((m) =>
            m.map((item) =>
              item.id === provisional - 1
                ? { ...item, content: item.content + payload.text }
                : item,
            ),
          );
        if (event === "error")
          throw new Error(
            typeof payload.message === "string"
              ? payload.message
              : "Research interrupted.",
          );
        if (event === "done" && typeof payload.message === "object") {
          complete = true;
          const final = payload.message;
          setMessages((m) =>
            m.map((item) =>
              item.id === provisional - 1
                ? {
                    ...final,
                    metadata: { ...final.metadata, ...payload.metrics },
                  }
                : item,
            ),
          );
        }
      });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      if (!complete)
        throw new Error(
          "Research stopped before completion. Your question is ready to retry.",
        );
      try {
        const list = await request<Conversation[]>("/api/conversations", {
          signal: controller.signal,
        });
        setConversations(list);
      } catch {
        /* The completed answer remains usable if refreshing history fails. */
      }
    } catch (e) {
      const stopped = controller.signal.aborted;
      let detail = stopped
        ? "Research stopped. Your question is ready to edit or retry."
        : e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.";
      setDraft(text);
      // Rejected requests never persisted this optimistic turn. Accepted or
      // transport-uncertain requests must be reconciled with authoritative storage.
      setMessages((current) => discardProvisionalTurn(current, provisional));
      if (streamReader) {
        try {
          await streamReader.cancel();
        } catch {
          /* An aborted reader may already be closed. */
        }
      }
      if (chatAttempted && !rejectedResponse && activeConversationId) {
        setPhase("Refreshing saved history…");
        try {
          const saved = await request<{
            conversation: Conversation;
            messages: Message[];
          }>(`/api/conversations/${activeConversationId}`, {
            signal: AbortSignal.timeout(10_000),
          });
          setMessages(saved.messages);
          setConversations((current) =>
            current.map((conversation) =>
              conversation.id === saved.conversation.id
                ? saved.conversation
                : conversation,
            ),
          );
        } catch {
          detail +=
            " Saved history could not be refreshed. This interrupted turn is not shown; reload the conversation before retrying to check what was saved.";
        }
      }
      setError(detail);
    } finally {
      lock.current = false;
      setBusy(false);
      setPhase("");
      generation.current = null;
      input.current?.focus();
    }
  }
  const history = (
    <>
      <button className="new-chat" onClick={newConversation} disabled={busy}>
        <Plus size={17} />
        New conversation<span>↗</span>
      </button>
      <label className="history-search">
        <Search size={15} />
        <input
          aria-label="Search conversations"
          placeholder="Search your conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="sidebar-heading">
        YOUR WORKSPACE
        <span>{conversations.length.toString().padStart(2, "0")}</span>
      </div>
      <div className="history-list">
        {conversations
          .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
          .map((c) => (
            <button
              key={c.id}
              disabled={busy}
              className={`history-item ${selected === c.id ? "active" : ""}`}
              onClick={() => openConversation(c.id)}
            >
              <MessageSquare size={15} />
              <span>{c.title}</span>
            </button>
          ))}
        {!conversations.length ? (
          <div className="history-empty">
            <History size={20} />
            <p>
              A little space for
              <br />
              your next big question.
            </p>
            <span>Your conversations will live here.</span>
          </div>
        ) : conversations.every(
            (c) => !c.title.toLowerCase().includes(query.toLowerCase()),
          ) ? (
          <p className="no-results">No matching conversations.</p>
        ) : null}
      </div>
      <div className="sidebar-bottom">
        <div className="memory-note">
          <span className="mini-orbit" />
          <div>
            <strong>Built to connect the dots.</strong>
            <p>Every conversation adds context.</p>
          </div>
        </div>
        <button
          className="about-button"
          onClick={(event) => {
            helpTrigger.current = event.currentTarget;
            setHelp(true);
          }}
        >
          <CircleHelp size={16} />
          About Recall
          <ArrowUpRight size={14} />
        </button>
        <div className="profile">
          <span className="avatar">Y</span>
          <div>
            <strong>Your research space</strong>
            <small>
              {status?.storage === "neon"
                ? "Saved with PostgreSQL"
                : "Session workspace"}
            </small>
          </div>
          <span className="online-dot" />
        </div>
      </div>
    </>
  );
  const evidence = (
    <>
      <div className="rail-title">
        <span>
          <Layers3 size={16} />
          Behind the answer
        </span>
        <button
          className="icon-button desktop-only"
          aria-label="Hide evidence panel"
          onClick={() => setRail(false)}
        >
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="rail-subtitle">
        A clear trail from question to insight.
      </div>
      <div className="evidence-tabs">
        <span>
          Sources <b>{sources.length}</b>
        </span>
        <span>
          <History size={13} />
          Memory <b>{memoryCount}</b>
        </span>
      </div>
      {sources.length ? (
        <div className="sources">
          {sources.map((source, i) => (
            <SourceCard key={`${source.id}-${i}`} source={source} />
          ))}
        </div>
      ) : (
        <div className="evidence-empty">
          <div className="evidence-illustration">
            <div className="paper back" />
            <div className="paper">
              <span />
              <span />
              <span />
              <div>
                <Check size={12} />
              </div>
            </div>
            <span className="orbit-dot" />
          </div>
          <h3>Clarity, not just answers.</h3>
          <p>
            Sources appear here as your research comes together. See what’s new,
            and what came from memory.
          </p>
          <span className="section-eyebrow">HOW RECALL WORKS</span>
          <div className="process-step">
            <span>01</span>
            <div>
              <strong>Start with a question</strong>
              <p>Bring your curiosity. We’ll follow it.</p>
            </div>
          </div>
          <div className="process-step">
            <span>02</span>
            <div>
              <strong>Ground it in evidence</strong>
              <p>Web research with a source trail.</p>
            </div>
          </div>
          <div className="process-step">
            <span>03</span>
            <div>
              <strong>Keep the context</strong>
              <p>Past findings, clearly dated.</p>
            </div>
          </div>
        </div>
      )}
      <div className="evidence-footer">
        <ShieldCheck size={14} />
        <span>
          Historical context is labeled.
          <br />
          Fresh sources are dated.
        </span>
      </div>
    </>
  );
  return (
    <div className={`workspace ${rail ? "" : "rail-hidden"}`}>
      <aside className="sidebar">
        <a href="/" className="brand" aria-label="Recall home">
          <Mark />
          <span>
            recall<span className="brand-period">.</span>
          </span>
        </a>
        {history}
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              ref={navigationTrigger}
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={19} />
            </button>
            <span className="workspace-label">Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {selected
                ? conversations.find((c) => c.id === selected)?.title ||
                  "Conversation"
                : "A fresh perspective"}
            </strong>
          </div>
          <div className="top-actions">
            <span className="mode-indicator">
              <span />
              {status?.mode === "live"
                ? "Live research"
                : status?.mode === "setup"
                  ? "Setup needed"
                  : status?.mode === "demo"
                    ? "Demo workspace"
                    : "Connecting"}
            </span>
            <button
              className="icon-button evidence-toggle"
              aria-label="Show evidence panel"
              ref={evidenceTrigger}
              onClick={() => {
                if (window.matchMedia("(max-width: 1180px)").matches)
                  setMobileEvidence(true);
                else setRail(true);
              }}
            >
              <PanelRightOpen size={18} />
            </button>
          </div>
        </header>
        {status?.mode === "demo" ? (
          <div className="mode-banner">
            <Sparkles size={14} />
            <span>
              Demo mode · No live AI or search. Temporary memory resets when the
              server restarts.
            </span>
          </div>
        ) : null}
        <div
          className={`conversation-area ${messages.length ? "has-messages" : ""}`}
        >
          {status?.mode === "setup" ? (
            <section className="setup-card">
              <span className="eyebrow">
                <span />A LITTLE SETUP, THEN POSSIBILITY
              </span>
              <h1>
                Your workspace.
                <br />
                <em>Ready when you are.</em>
              </h1>
              <p>
                Configure your provider credentials and access settings on the
                server to start researching. Secrets belong in your environment,
                never in a conversation.
              </p>
              <div className="setup-details">
                <strong>Configuration needed</strong>
                <ul>
                  {(status.missing?.length
                    ? status.missing
                    : ["Server configuration"]
                  ).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <span>
                  Use your .env file locally or your deployment’s secret
                  settings.
                </span>
              </div>
            </section>
          ) : messages.length ? (
            <div className="message-list">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-avatar">
                    {message.role === "assistant" ? <Mark small /> : "Y"}
                  </div>
                  <div className="message-body">
                    <div className="message-heading">
                      <strong>
                        {message.role === "assistant" ? "Recall" : "You"}
                      </strong>
                      <span>
                        {message.role === "assistant"
                          ? "RESEARCH, WITH CONTEXT"
                          : null}
                      </span>
                    </div>
                    {message.content ? (
                      <div className="prose">
                        <Markdown message={message} />
                      </div>
                    ) : busy ? (
                      <div className="thinking">
                        <i />
                        <i />
                        <i />
                        <span>Following your question</span>
                      </div>
                    ) : null}
                    {message.sources.length ? (
                      <div className="inline-sources">
                        {message.sources.map((s, i) => {
                          const url = safeSourceUrl(s.url);
                          return url ? (
                            <a
                              key={`${s.id}-${i}`}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span>{s.id}</span>
                              {s.title}
                              <ArrowUpRight size={12} />
                            </a>
                          ) : (
                            <span key={`${s.id}-${i}`}>
                              {s.id} · {s.title}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                    {typeof message.metadata?.durationMs === "number" ? (
                      <div className="answer-meta">
                        <Check size={12} />
                        {(message.metadata.durationMs / 1000).toFixed(1)}s
                        {typeof message.metadata.searches === "number"
                          ? ` · ${message.metadata.searches} web searches`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
              <div ref={end} />
            </div>
          ) : (
            <motion.section
              className="welcome"
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="welcome-symbol">
                <Mark />
                <span className="spark spark-one">✧</span>
                <span className="spark spark-two">+</span>
              </div>
              <div className="eyebrow">
                <span />A LITTLE CURIOSITY GOES A LONG WAY
              </div>
              <h1>
                Good questions
                <br />
                deserve a <em>memory.</em>
              </h1>
              <p className="welcome-description">
                Explore what’s happening now.
                <br />
                Build on what you discovered before.
              </p>
              <div className="starter-grid">
                {starters.map(({ icon: Icon, label, prompt }, i) => (
                  <button
                    className="starter-card"
                    key={label}
                    disabled={busy || loading || !status}
                    onClick={() => {
                      setDraft(prompt);
                      input.current?.focus();
                    }}
                  >
                    <div>
                      <Icon size={18} />
                      <span>0{i + 1}</span>
                    </div>
                    <strong>{label}</strong>
                    <p>{prompt}</p>
                    <ArrowUpRight size={15} className="starter-arrow" />
                  </button>
                ))}
              </div>
            </motion.section>
          )}
        </div>
        <div className="composer-wrap">
          {error ? (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={14} />
              </button>
            </div>
          ) : null}
          <AnimatePresence>
            {busy ? (
              <motion.div
                className="research-status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                role="status"
              >
                <span className="pulse-dot" />
                {phase}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="question">
              Ask Recall a question
            </label>
            <textarea
              id="question"
              ref={input}
              rows={2}
              value={draft}
              disabled={busy || status?.mode === "setup"}
              placeholder={
                status?.mode === "setup"
                  ? "Complete setup to begin…"
                  : "Ask anything. Pick up where you left off."
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-bottom">
              <div className="composer-tools">
                <span>
                  <Globe2 size={13} />
                  Web research
                </span>
                <i />
                <span>
                  <Clock3 size={13} />
                  Time-aware
                </span>
              </div>
              {busy ? (
                <button
                  type="button"
                  className="send-button stop"
                  aria-label="Stop research"
                  onClick={() => generation.current?.abort()}
                >
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  aria-label="Send question"
                  disabled={
                    !draft.trim() ||
                    loading ||
                    !status ||
                    status.mode === "setup"
                  }
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </form>
          <div className="composer-footnote">
            <span>
              Thoughtful answers. Traceable sources. A memory that connects
              them.
            </span>
            <span>↵ to send</span>
          </div>
        </div>
        <footer className="main-footer">
          <span>MADE FOR THE CURIOUS</span>
          <span>Recall can make mistakes. Check the sources.</span>
        </footer>
      </main>
      {rail ? <aside className="evidence-rail">{evidence}</aside> : null}
      <Dialog.Root open={mobileMenu} onOpenChange={setMobileMenu}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="mobile-drawer"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              navigationTrigger.current?.focus();
            }}
          >
            <div className="drawer-heading">
              <Dialog.Title className="brand">
                <Mark small />
                recall.
              </Dialog.Title>
              <Dialog.Close
                className="icon-button"
                aria-label="Close navigation"
              >
                <X size={20} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Your conversations and workspace navigation.
            </Dialog.Description>
            {history}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={mobileEvidence} onOpenChange={setMobileEvidence}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay evidence-dialog" />
          <Dialog.Content
            className="mobile-drawer right evidence-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              evidenceTrigger.current?.focus();
            }}
          >
            <Dialog.Title className="sr-only">Research evidence</Dialog.Title>
            <Dialog.Description className="sr-only">
              Sources and historical context for the latest answer.
            </Dialog.Description>
            <Dialog.Close
              className="icon-button drawer-close"
              aria-label="Close evidence"
            >
              <X size={20} />
            </Dialog.Close>
            {evidence}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={help} onOpenChange={setHelp}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="about-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              helpTrigger.current?.focus();
            }}
          >
            <Dialog.Close
              className="icon-button drawer-close"
              aria-label="Close about Recall"
            >
              <X size={20} />
            </Dialog.Close>
            <Mark />
            <Dialog.Title>Research, with a memory.</Dialog.Title>
            <Dialog.Description>
              Recall brings current web research and dated conversation context
              into one thoughtful workspace.
            </Dialog.Description>
            <div className="about-features">
              <p>
                <Globe2 size={18} />
                <span>
                  <strong>One focused tool</strong>Web search grounds your
                  questions in evidence.
                </span>
              </p>
              <p>
                <History size={18} />
                <span>
                  <strong>Then, clearly separated from now</strong>Historical
                  sources carry H identifiers. Current sources carry S
                  identifiers.
                </span>
              </p>
              <p>
                <BookOpen size={18} />
                <span>
                  <strong>Your trail of thought</strong>
                  {status?.storage === "neon"
                    ? "Conversations are stored in PostgreSQL on Neon."
                    : "This workspace uses temporary memory. It resets on server restart."}
                </span>
              </p>
            </div>
            <div className="about-mode">
              {status?.mode === "demo"
                ? "You’re exploring a demo. Live AI and web search are not enabled."
                : status?.mode === "live"
                  ? `Live research · ${status.model}`
                  : "Provider configuration is required to enable live research."}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
