# Explain the implementation

## Follow one request

1. `public/app.js` posts the conversation ID, message and browser timezone. It incrementally parses SSE, shows status and provisional tokens, then replaces them with the final persisted answer.
2. `src/server.js` validates the request, blocks cross-site access, acquires a per-conversation lock and supplies an abort signal. It never sends provider keys to the browser.
3. `src/agent.js` retrieves memory **before** storing the new user message. This prevents the current question from masquerading as a remembered exchange. It keeps old and new evidence in separate citation namespaces.
4. `src/time.js` resolves a conservative set of calendar expressions. `src/memory.js` gets exact local-date questions or FTS matches, then pairs each with its actual next assistant message in that conversation.
5. `src/providers.js` streams the model response. If the model requests `web_search`, the agent validates its arguments and executes only that function. Search snippets become evidence, not new system instructions.
6. The final answer’s citation IDs are checked against the evidence registry. The answer, cited sources, timestamps and metrics are saved together, then a `done` event tells the UI it is complete.

## Decisions worth defending

- **Why record exact answers?** A future price comparison needs the old claim and old billing assumptions, not a summary that may have dropped them.
- **Why no vector DB?** The challenge explicitly stresses time and previously discussed entities. Date filters plus FTS are deterministic, cheap and testable. Semantic retrieval is an improvement only after measuring missed cases.
- **Why streaming but no separate planning agent?** Direct answers need one model call. A planner would add a fixed latency tax to every message.
- **Why cap search?** A model can request repeated or irrelevant searches. Application code, not the prompt alone, enforces the spend/latency boundary.
- **Why not force search for everything?** Greetings and personal recall gain nothing from web results. Current pricing or revalidation does.
- **What do citations guarantee?** The cited source was available to the answer, with a captured snippet and timestamp. They do not automatically prove every statement is supported.
- **What happens on Stop?** The connection aborts, upstream fetches receive cancellation and the conversation lock is released. The question remains stored; an incomplete answer is not saved as final.
- **Why a demo mode?** Reviewers can install and inspect the app without secrets. It is not a substitute for live integration testing and is always labeled.

## Suggested one-minute explanation outline

Use your own words after running and reading the project. Do not claim unperformed benchmarks or independent authorship.

- 0–10s: The central problem is distinguishing actual conversation memory from current web evidence.
- 10–25s: Explain SQLite timestamps, date-first/FTS retrieval and preserved answer/source snapshots.
- 25–40s: Explain the one-tool loop, parallel searches, bounded rounds and streaming.
- 40–50s: Show a missing-history query and a dated recheck with historical/current citation labels.
- 50–60s: Name the tradeoff: simple deterministic retrieval now; measured semantic recall and live evaluation next.
