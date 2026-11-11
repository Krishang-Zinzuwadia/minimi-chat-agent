# Explain the implementation

This is a map for understanding and discussing the code, not a script for claiming work or experience that is not yours. AI tools assisted development.

## Start with the request

1. `app/page.tsx` renders `RecallWorkspace` from `components/recall-workspace.tsx`.
2. The component reads `/api/status` and conversation history. It sends a message with the browser's IANA timezone to `/api/chat`.
3. `app/api/[[...path]]/route.ts` delegates native Next requests to `createApi` in `lib/api.ts`.
4. The API checks content type, byte size, Zod fields, timezone, owner and conversation existence. It obtains a database lease before creating the SSE stream.
5. `Agent.run` retrieves history, saves the question, runs a bounded research loop, validates citation identifiers and saves the answer. `done` carries the authoritative saved message.
6. The UI parses arbitrarily split SSE frames. Text deltas provide feedback, while the final event replaces provisional text. Stop aborts the request; a generation guard prevents duplicate sends.

## Explain temporal memory

`lib/temporal.ts` interprets dates in the user's timezone, not the server's local timezone. An explicit ISO date is exact. A month/day without a year uses the most recent occurrence. `last Tuesday` is the most recent Tuesday strictly before today when today is Tuesday. `on Monday` can refer to today if today is Monday. “Still correct today?” is a freshness signal, not a request to discard earlier conversation history.

`NeonMemory.retrieve` has two paths:

- Explicit date: retrieve that owner's user messages whose timestamp falls on the requested local day, across conversations.
- Topic: English Postgres full-text search with OR terms and stemming. An assistant match maps back to its preceding user question.

Both return at most 12 question/answer pairs and a total count. An answer is paired only if it is the next message after that question. This avoids joining an abandoned question to a later turn. The agent additionally includes up to 16 recent current-conversation messages and caps the serialized context. Truncation is stated in the model instructions.

The original text and source snapshots are immutable records in the app's normal flow. Historical sources get new `H` identifiers for this request; live search gets `S` identifiers. The URL may match, but a saved retrieval timestamp is not silently refreshed.

## Explain the model/tool loop

`ResponsesModel` uses the official SDK to parse Responses SSE. It does not store conversations at OpenAI. With `store:false`, opaque encrypted reasoning output is carried into the next request together with the function call and its `function_call_output`. This state is not shown in the UI.

Only `web_search` is advertised. Arguments are validated as one to three nonempty queries of at most 500 characters. Repeated queries are deduplicated case-insensitively and the entire turn has at most six queries and three model rounds. Firecrawl searches the web and returns page excerpts in the same request. No arbitrary URL fetch or second agent tool is available.

Freshness language forces a search on the first model round and sets Firecrawl's page cache age to zero. Independent queries run concurrently. Search failures are tool results the model can reason about, and the final response adds a warning if verification failed. If an answer cites an unknown ID, it becomes `[unverified source]`. This establishes source provenance; it cannot prove every factual statement correct.

## Explain persistence and concurrency

`db/schema.sql` creates conversations and messages. Sources/metadata are JSONB; generated `tsvector` plus GIN index supports lexical retrieval. All SQL parameters are bound, and all reads/writes require the owner identity. A conversation UUID alone grants no access.

An atomic conditional UPSERT/CTE coordinates different Worker instances. An `owner_limits` row allows one active turn per owner, across conversations, and at most 60 admitted turns per UTC day. Admitted attempts still count after cancellation or failure; rejected claims do not. It has a token and expiry; only the holder's token can release it. A stale request cannot release a newer lease. The TTL exceeds the request deadline. Saving the first user message also sets the title in the same SQL statement while holding the conversation row lock.

The schema migration runs explicitly as a transaction. It is not a background side effect of reading history, building or starting the server. PGlite tests execute this SQL against an actual embedded PostgreSQL engine, while real Neon transport remains a separate release check.

## Explain authentication and failure modes

`AUTH_MODE=local` permits only loopback development. Hosted APIs require Cloudflare Access. `jose` verifies signature, exact issuer, audience, expiry and required claims against the team's published keys. A forged header cannot create an identity. Cross-origin requests are rejected, and sources only link to HTTP(S) URLs without embedded credentials.

There is a 90-second API deadline, per-provider deadlines, a bounded output and request-body limit, and a same-conversation lease. The 60-turn owner cap is a request limit, not a currency-denominated spending cap. Stop propagates an abort signal. The user's question may already be saved when cancellation happens, but an incomplete assistant answer is not persisted.

Demo mode clearly says it is offline, uses temporary per-owner in-process memory and never calls external providers. It is useful for UI and contract tests, not proof of production readiness.

## Questions worth practicing

- Why store original answers instead of asking the model to reconstruct history?
- Why are source retrieval time and page publication time different?
- What happens if two Worker instances answer one conversation at once?
- Why not use embeddings, Hono or an agent framework for this scope?
- What do a build, a mocked provider test and a live integration test each prove?
- Why must a hosted paid-API app require authentication and a spending budget?
- How could idempotency, resumable streaming and per-owner rate limits improve this design?
