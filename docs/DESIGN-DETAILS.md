# Design decisions and evidence

The [one-page design](../DESIGN.md) is the overview. This companion explains the shipped choices, their costs and the boundaries of verification. Current deployment evidence is in [cloudflare-deployment.md](cloudflare-deployment.md).

## Application and deployment architecture

The frontend and backend share a Next.js/TypeScript project. Route Handlers validate input and orchestrate research; the agent and storage adapters stay in separate modules, so tests can replace providers without replacing the orchestration logic. Native Web Streams carry incremental SSE events. This avoids a second application server and the extra cross-origin/API boundary that a separate Hono service would introduce for this challenge.

The normal Node entrypoint remains available for local use. vinext/Vite produces the Cloudflare Worker and static assets from the same application. This reduces duplicated implementation, but introduces framework-adapter compatibility risk: building successfully alone does not prove the Worker behaves correctly. The live deployment was therefore checked separately for API operation, streaming and persistence. Preview URLs remain disabled.

Neon's HTTP driver fits an ephemeral Worker runtime without maintaining a TCP connection pool. PostgreSQL provides transactional schema updates, atomic leases/counters, full-text queries and JSONB evidence snapshots. SQLite would need a separate persistence strategy across distributed instances. No embedding service is required for the current lexical retrieval approach, which is easier to inspect but misses semantically related paraphrases.

## Memory, concurrency and evidence

Before answering, the application retrieves recent messages and prior matching question/answer pairs scoped to the current owner. Date interpretation is deterministic and uses the request's IANA timezone. Topic retrieval uses Postgres full-text search. This makes the retrieval rule explainable, but does not promise general natural-language date understanding or exhaustive long-history recall. Missing history is explicitly reported.

Database leases prevent simultaneous turns from racing on one owner's memory. A token identifies the holder so a stale completion cannot release a replacement lease. This is different from durable queueing or exactly-once execution: cancellation can leave a saved question without an answer, and resumable/idempotent turns are not implemented.

Sources retain retrieval timestamps and snapshots. Historical and new evidence use separate identifiers even for the same URL, so a recheck does not silently overwrite what supported an earlier answer. Only cited sources persist with the completed answer. Citation validation checks identity/provenance, not whether every factual inference is true. Streamed text is provisional until the final event supplies the saved, validated result.

## Model and search decisions

GPT-6 Luna is fixed in public mode. OpenAI Responses uses `store:false` and encrypted reasoning continuation through tool rounds. The only callable tool is `web_search`, implemented using Firecrawl search/extraction; adding a separate scrape or browser tool would break the chosen single-tool boundary. Freshness-sensitive questions force search and bypass cached page data.

The explicit loop allows at most three model rounds and six deduplicated queries, with parallel independent queries within a batch. Public model calls have no SDK retries, at most 1,500 output tokens and at most 48,000 serialized input/instruction/tool characters. These bounds trade depth and answer length for predictable work. The turn deadline is 90 seconds; provider deadlines and cancellation also bound work. A failed search is disclosed rather than represented as successful research.

## Interface choices

The workspace uses direct, editable suggested prompts instead of a grid of decorative cards. Choosing a suggestion fills and focuses the composer; it does not send immediately, so users retain control over the question. Conversation search supports returning to prior work. Evidence/history panels are available on demand rather than occupying the main answer area throughout.

Suggestions derive from at most 40 owned questions using fixed templates and conservative sensitive-pattern filtering. No model call, external account data or stored inferred profile is needed. This reduces latency and privacy exposure, but it is an English heuristic rather than semantic personalization or a complete sensitive-data classifier.

IBM Plex Sans is self-hosted to avoid third-party font requests. Light/Dark/System modes use a validated first-party preference cookie and CSS system preference for consistent initial rendering. Radix Dialog, accessible controls and contrast assertions support usability; contrast tests alone do not establish complete accessibility compliance. Motion and responsive layout are presentation choices, not substitutes for interaction testing.

## Public identity and abuse controls

The public domain issues a signed, host-only, 30-day HttpOnly/Secure/SameSite cookie. Owner-scoped queries separate visitors and cannot expose previous Cloudflare Access owners' history. Writes require the configured canonical origin. Missing configuration fails closed. Credentials are Worker secrets, never browser variables or repository contents.

Anonymous identity is deliberately lightweight, not an account system. Clearing the cookie or reaching expiry loses access to that visitor's history. Replacing a cookie can obtain a new visitor allowance; durable global limits still apply. Public users can exhaust those shared limits and make the demo temporarily unavailable.

Atomic Neon counters charge admission before work; failures and cancellations are not refunded. Global daily/lifetime ceilings are API 3,000/30,000, chat 30/300, model 60/600 and search 60/600. Visitor daily ceilings are API 120, chat 6, model 12 and search 12; visitor lifetime ceilings are 30 times those values. Daily rollover uses UTC; lifetime fuses persist across redeployments. These are request ceilings, not a guaranteed monetary budget. Rejected traffic can still incur infrastructure work, and Cloudflare/Neon costs are not globally capped by this code.

## What verification proves

TypeScript, 70 automated tests and the Workers build passed. Automated coverage includes SQL ownership/leases, temporal and DST behavior, SSE/provider fixtures, citations, suggestions/contrast, signed sessions, origin checks and quota behavior. Independent review found no P0/P1 in the reviewed public-security changes; it is not a security certification.

Live checks separately exercised actual Luna and Firecrawl calls through the deployed app, streamed a cited answer and reloaded two persisted Neon messages. A second visitor received 404 for the first visitor's conversation; a hostile-origin write received 403. Concurrent live database checks admitted exactly the configured synthetic ceiling. Browser inspection verified the public UI loaded and became ready. Thirty-six Playwright cases were discovered, but discovery is not evidence that the full browser suite executed.

Remaining work includes account recovery, currency-aware budgets, infrastructure-level abuse protection, richer telemetry, semantic reranking/date clarification and resumable turns. The release is a verified challenge demo, not comprehensive production hardening.
