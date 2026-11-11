# Recall · minimi chat agent

A time-aware research assistant: ask a question, return to an earlier conversation, and check what changed using current web evidence. Built for the [minimi hiring challenge](https://app.notion.com/p/minimi-hiring-challenge-build-a-chat-agent-4100a8b933b181b98277d8ea5a534d6f).

**Status:** Implementation complete; live provider setup and deployment verification pending. Not submitted. The implementation runs without credentials in an explicitly labelled offline demo. Live provider access and production hosting still require secure setup and live verification.

## Run locally

Node **22.13+** and npm are required.

```sh
npm install
cp .env.example .env
npm run dev
```

Open http://127.0.0.1:3000. With no secrets, the app uses temporary in-process demo memory and makes **no model or search calls**. Demo responses exercise timestamped storage and recall; they are not AI-generated. History disappears on restart and is not shared between server processes.

For live mode, configure all three values privately in `.env`, then apply the explicit migration and restart:

| Variable            | Required for live mode                                        | Source                                                          |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| `OPENAI_API_KEY`    | Yes                                                           | [OpenAI project API keys](https://platform.openai.com/api-keys) |
| `FIRECRAWL_API_KEY` | Yes                                                           | [Firecrawl dashboard](https://www.firecrawl.dev/app)            |
| `DATABASE_URL`      | Yes, a database connection string rather than another API key | [Neon project → Connect](https://console.neon.tech/)            |

```sh
npm run db:migrate
npm run dev
```

Use an existing Neon database and its pooled PostgreSQL connection URL. The migration is transactional and idempotent; it creates this app's schema but does not import the earlier SQLite implementation's data. It never runs automatically at startup or build time. Do not point it at an unrelated production database.

`OPENAI_MODEL` defaults to `gpt-6-luna`, `OPENAI_BASE_URL` to the official OpenAI API, and `TIMEZONE` to UTC. The browser sends its IANA timezone with each question. `DEMO_MODE=true` explicitly forces temporary demo mode. Partial live configuration fails closed with a setup message.

Keep keys server-side. Never commit `.env` / `.dev.vars`, use `NEXT_PUBLIC_*` for credentials, or paste secrets into chat. Provider billing and model access are separate from a ChatGPT subscription. Firecrawl search with page extraction consumes provider credits. A free tier is not a guarantee of a free production deployment.

## What it does

- A restrained Next.js workspace with direct prompt suggestions above the composer, self-hosted IBM Plex Sans, conversation search, Markdown answers and on-demand source/history panels.
- Light, Dark and System appearance with a first-party preference cookie, server-consistent rendering and accessible text contrast.
- Timestamped conversation history, scoped to the authenticated owner in Neon Postgres.
- Suggestions begin generic and gradually use safe, recent topics from that owner's questions. Selecting one fills and focuses the composer without sending it.
- Deterministic date retrieval for `3 Nov`, `2026-11-03`, `yesterday`, `on Monday` and `last Tuesday`, interpreted in the question's timezone.
- Postgres full-text retrieval for topic follow-ups across conversations, plus bounded recent context from the current conversation.
- OpenAI **Responses API** with the real `gpt-6-luna` model, streaming output and stateless reasoning/tool continuation.
- Exactly one external agent tool, `web_search`, backed by Firecrawl search with page excerpts. No shell, arbitrary browsing, second search tool or external agent framework.
- Historical evidence labelled `H1`, `H2`, etc.; newly retrieved evidence labelled `S1`, `S2`, etc. Saved retrieval dates are distinct from page publication dates.
- Freshness questions force a new search and bypass cached page data. Missing history, failed searches and unverified citations remain explicit.
- Input/context/output bounds, a six-query budget, deadlines, cancellation and Postgres admission guards: one active turn per owner and 60 admitted turns per UTC day.

Try the challenge's scenarios after creating real history on the relevant dates:

- “What did I ask you on 3 Nov, and is it still correct today?”
- “We shortlisted 5 CRMs on Monday. Have any of them shipped updates since then?”
- “Last Tuesday I asked about Postgres hosting options. Any pricing changes since then?”

There is no fabricated preloaded conversation. A missing dated conversation produces an honest refusal to reconstruct it.

## How prompt suggestions become personal

`GET /api/suggestions` reads at most 40 of the authenticated owner's recent user messages. It makes no model/search calls and creates no inferred profile. Recognized public topics can appear after a clear recent question; short literal subjects or explicitly named projects require repetition in distinct questions. Recency, repeated interest and topic diversity determine which of the three generic rows are replaced.

Credential/contact/sensitive-data and instruction-like patterns exclude the entire message. Suggestions use fixed follow-up templates rather than quoting whole conversations or asserting unrecorded facts. This is a conservative English heuristic, not semantic personalization or a complete sensitive-data classifier. Unrecognized topics remain generic; no connected email, GitHub or other account data is read. Offline demo history and personalization reset when its server restarts.

Appearance is saved only in the first-party `recall-theme` cookie. System mode follows the browser's color preference through CSS. The server validates the cookie and does not publicly cache preference-specific HTML. Font files and their OFL license are bundled locally, with no font-service requests.

## Stack and layout

- **UI:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Motion, Radix Dialog, Lucide, React Markdown and GFM.
- **Backend:** Next.js Route Handlers, native Web Streams/SSE, Zod validation, OpenAI SDK and direct Firecrawl HTTP calls.
- **Data:** Neon serverless HTTP driver, PostgreSQL JSONB evidence snapshots, GIN full-text index and atomic leases.
- **Hosting target:** Cloudflare Workers via vinext/Vite. The normal Node `npm run dev` path remains supported.

```text
app/                  Next.js page, layout and API route
components/           Responsive Recall workspace
lib/api.ts            Request validation, ownership, SSE lifecycle
lib/agent.ts          Retrieval, bounded tool loop, citations, persistence
lib/providers.ts      OpenAI Responses and Firecrawl adapters
lib/memory.ts         Owner-scoped PostgreSQL queries
lib/temporal.ts       Explicit date interpretation
lib/suggestions.ts    Bounded, owner-history prompt suggestions
lib/auth.ts           Loopback-only local mode / verified Access JWT
lib/demo-memory.ts    Honest ephemeral offline mode
lib/client/stream.ts  Incremental SSE parsing
scripts/migrate.ts    Explicit schema migration
db/schema.sql        Tables, indexes and lease fields
test/                Unit, SQL integration and browser tests
```

## Verify

```sh
npm run check
npm test
npm run build
npm run smoke
npm run check:cloudflare
npm run build:vinext
npx playwright install chromium
npm run test:browser
```

Unit/integration tests use fake provider responses and embedded PostgreSQL (PGlite); no paid APIs are invoked. Browser tests force demo mode and clear secrets. See [verification evidence](docs/VERIFICATION.md), [design rationale](DESIGN.md) and the [code walkthrough](docs/WALKTHROUGH.md).

## Deployment and limitations

See the [Cloudflare deployment runbook](docs/DEPLOYMENT.md). Public Worker routes are disabled. Hosted APIs require cryptographically verified Cloudflare Access, separate owner identities, secure secrets, an applied Neon schema and production smoke tests. The current Cloudflare account does not have Access enabled; no Worker has been deployed and no paid plan has been selected.

Retrieval is lexical, not semantic. Dates use documented conservative rules rather than a language-model date parser. Context is capped, so long histories can be incomplete. Sources can be outdated or wrong, and citation validation verifies provenance, not the truth of every generated claim. Cancellation may leave a saved question without an answer. There are per-turn limits and a shared 60-turn daily owner cap, but no currency-denominated billing quota, queue, retries for failed turns or resumable streams. Aborted or failed admitted turns count toward the daily cap. vinext/Cloudflare tooling is beta; a successful build is not a production runtime test.

AI tools assisted implementation. Review the walkthrough and tests and be prepared to explain the choices. The official challenge asks for a public repository at submission; the owner has authorized public release.

### Public visitor mode

Set `AUTH_MODE=public`, `PUBLIC_ORIGIN` to the exact HTTPS origin (no trailing
slash), and a random `PUBLIC_SESSION_SECRET` of at least 32 characters in the
host's secret store. Run the additive schema migration before enabling this mode.
GET `/api/conversations` bootstraps a signed, HttpOnly, Secure, SameSite=Strict,
host-only 30-day visitor cookie. Clearing it loses access to that visitor's
history; it never grants access to an Access-authenticated owner's history.
Writes require an exact same-origin Origin header. No shared public owner exists.

Public requests fail closed when Neon admission fails. Durable atomic ceilings
are 3,000 API attempts/day (30,000 lifetime), 30 chat attempts/day (300 lifetime),
and 60 requests/day each for OpenAI and Firecrawl (600 lifetime each). Visitors
are capped at 120 API, 6 chat, and 12 requests per provider per UTC day, with
30 times those limits over their lifetime. Failed/cancelled attempts count.
Clearing cookies cannot bypass global caps. Lifetime counters do not reset on
redeploy or at midnight. These are usage ceilings, not guaranteed dollar limits;
provider billing controls should also be configured. Public model requests use
only gpt-6-luna, no SDK retries, at most 1,500 output tokens and 48,000 characters
of serialized input/instructions/tools per request. When a global lifetime cap
is exhausted, service remains capped until an operator explicitly reviews it.
