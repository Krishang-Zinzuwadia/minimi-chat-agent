# Recall · minimi chat-agent challenge

A small chat agent with a sense of time. It keeps the question, answer, timestamp and sources together, so “is your answer from last Tuesday still correct?” is a comparison against an actual saved answer, not a guess.

Built for the [official minimi challenge](https://app.notion.com/p/minimi-hiring-challenge-build-a-chat-agent-4100a8b933b181b98277d8ea5a534d6f). **This repository is private while being prepared. It has not been submitted.** The challenge eventually requests a public repository; changing visibility and submission are separate steps.

## Run

Requires **Node.js 22.13+** (Node 24 recommended). No database service or runtime dependencies.

```sh
npm install
npm run dev
```

Open **http://localhost:3000**. With no keys, the app starts in an unmistakably labeled **offline demo**: conversation storage and retrieval work, but it does not generate model answers or pretend to search the web.

For real answers:

```sh
cp .env.example .env
# Add OPENAI_API_KEY and TAVILY_API_KEY to .env
npm run dev
```

Every required key is listed in `.env.example`. The default model is `gpt-4.1-mini`; `OPENAI_MODEL` and `OPENAI_BASE_URL` support compatible tool-calling models. Live calls may incur your providers’ charges. No keys, accounts, credits or subscriptions are created by this project. Both keys are required for live mode; `npm run demo` always stays offline.

## Try it

1. Ask “Compare Neon, Supabase and Render for a small Postgres project. Include current pricing and billing basis.”
2. Ask “Which one would you pick?” The current conversation remains in context.
3. Start a new conversation and ask “What Postgres options did we discuss?” Lexical retrieval finds the earlier exchange.
4. Ask “What did I ask you on [the date shown in your chat]? Is your answer still correct today?” It retrieves that local calendar day, preserves the old answer, bypasses the local search cache and checks current evidence.
5. Try a date with no history. It says the record is missing instead of inventing one.

Nothing is pre-seeded as if you had said it. The automated tests contain fixed historical fixtures for 3 November, weekday resolution, pricing comparisons and missing memories.

## What is implemented

- **One external tool: `web_search`.** Up to three independent queries run concurrently, with six queries and three model turns per user turn.
- **Durable memory:** SQLite with FTS5, timestamped user/assistant messages and immutable source snapshots. Exact local-date retrieval takes precedence over lexical relevance; recent conversation remains available.
- **Time-aware comparisons:** original evidence is labeled `[H1]`; newly retrieved sources are `[S1]`. Retrieval time and provider-estimated publication/update date are different fields. An unchanged current price alone cannot establish when a change occurred.
- **Honest uncertainty:** missing memories, empty results, provider failures, malformed tools, unknown citations and timeouts have explicit handling.
- **Responsive chat:** real model token streaming over SSE, stop controls, saved conversations, source links, timestamps and memory provenance.
- **Bounded work:** context limits, short search cache, fresh-check cache bypass, provider timeouts, one active turn per conversation, at most three simultaneous turns and cancellation on disconnect.

## Verification

```sh
npm test
npm run check
npm run smoke
```

Tests exercise the real SQLite layer, HTTP routes, agent orchestration and provider adapters. External model/search responses are controlled fixtures, not paid requests. They cover dated recall, timezone/day boundaries, persistence, citation binding, cache bypass, tool limits, malformed input, origins, concurrent turns, streaming framing and provider failure. See [verification notes](docs/VERIFICATION.md) for exactly what ran and what remains unverified.

## Privacy and limits

This is a **single-user local app**, not a hosted multi-tenant service. It binds only to loopback, validates Host/Origin and rejects cross-site requests. No authentication is included; do not expose it through a public tunnel or reverse proxy.

Chats are stored locally in `data/recall.sqlite`; demo data uses `data/demo.sqlite` so demo answers do not contaminate live history. `.env` and `data/` are ignored by Git. Back up the directory if needed; deleting it resets history. In live mode, the model provider receives the prompt, bounded conversation history and retrieved memories; Tavily receives selected search queries. Avoid entering information you do not want sent to those providers. Secrets stay server-side and are not included in model context.

Date resolution intentionally covers explicit ISO dates, English named dates, weekdays, today and yesterday. Ambiguous numeric dates and vague ranges are not guessed. Lexical retrieval can miss paraphrases. Search snippets can be stale or incomplete even after a fresh provider request. Citation validation proves a source ID exists, not that a claim is entailed. Model behavior and live provider quality still require real-world evaluation.

## Understand the code

Read [DESIGN.md](DESIGN.md) for the one-page architecture and tradeoffs, then [the walkthrough](docs/WALKTHROUGH.md) for file responsibilities and interview talking points. AI coding tools assisted this implementation, which the challenge explicitly permits. The applicant should review, run and understand the code before presenting it as their work.
