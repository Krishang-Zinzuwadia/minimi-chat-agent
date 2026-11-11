# Verification record

Local checks on 11 November 2026, Node.js 24.22.1, after the Next.js/Neon rewrite.

## Passed locally

- `npm install` and committed lockfile, with Vite 8.3.8 and the compatible fflate 0.7.5 security override.
- `npm audit`: **0 vulnerabilities** at verification time.
- `npm run check`: strict TypeScript check after a clean Next build directory.
- `npm test`: **45 tests passed, 0 failed, 0 skipped**.
- `npm run build`: production Next.js build, including the dynamic catch-all API route.
- `npm run smoke`: starts the compiled Next server, fetches the actual page, creates a conversation, completes demo SSE, reloads two saved messages and rejects a hostile Origin. No live providers called.
- `npm run check:cloudflare`: **10 supported, 0 partial, 0 issues**.
- `npm run build:vinext`: production Workers bundle builds with both UI and API. Non-fatal framework sourcemap/chunking and route-classification warnings remain.
- `npm run test:browser -- --list`: **20 browser cases** discovered across desktop Chromium and mobile Chromium. Discovery is not execution.
- Independent review and regression fixes: NextRequest loopback normalization, historical versus recheck date selection, shared owner concurrency/daily admission, duplicate search queries, and optimistic/partial message recovery.

## What the tests cover

- Real embedded PostgreSQL execution via PGlite: idempotent schema, bound parameters, owner isolation, stemming/OR full-text matching, assistant-to-question pairing, timezone day selection, source snapshots and retrieval caps.
- Atomic conversation/owner leases across adapter instances, 60-turn UTC-day limit, concurrent different conversations, separate owners, expiry takeover and stale token release.
- Deterministic temporal examples, DST boundaries, invalid dates, product-name ambiguity and separate recall/recheck dates.
- OpenAI Responses SSE fixtures, stateless encrypted reasoning continuation, bounded single-tool loop and Firecrawl response validation/cache/freshness behavior.
- Missing history, offline mode, historical/current citation separation, failures and cancellation without saving an incomplete assistant answer.
- Native API request validation, body bounds, timezone errors, SSE completion, lease release and client disconnect propagation.
- Cloudflare Access with locally generated test-only RSA signatures: valid identity, wrong audience/issuer, expiry and forged tokens; loopback/Host/Origin protections.
- Client SSE chunk framing, safe links, API error guards and provisional-turn cleanup.

## Browser and CI evidence

The GitHub workflow runs Node 22/24 checks, tests, Next build and production smoke; a separate job builds Cloudflare; another runs all 20 Playwright cases against an isolated demo server and retains desktop/mobile screenshots, first-retry traces. Browser tests explicitly clear provider/database secrets.

The local environment blocks Chromium's required socket operation. Therefore real browser execution and screenshots must be verified from the workflow for the exact commit, not inferred from test discovery. See the [Verify workflow](https://github.com/Krishang-Zinzuwadia/minimi-chat-agent/actions/workflows/ci.yml) for each exact commit's results and its `recall-browser-evidence` artifact.

## Still not verified

- Live OpenAI/Firecrawl calls: no provider credentials were supplied or created. Real model access, answer quality, provider latency, billing and quotas remain release checks.
- Real Neon transport and deployed persistence: SQL passes on embedded PostgreSQL, not a provisioned Neon project.
- Cloudflare runtime preview: local preview was blocked by `os.networkInterfaces()` / `uv_interface_addresses` in the restricted environment. Building the bundle does not verify SSE or authentication on Workers.
- Production deployment, configured Access, real two-identity isolation, provider budgets and load. Worker routes remain disabled and nothing has been deployed.

## Before submission

Configure credentials securely, apply the schema to the correct database, verify live dated comparisons and source provenance, exercise the protected Cloudflare deployment, and understand the walkthrough/design in your own words. The official challenge requests a public repository and a short explanation; changing visibility and submitting the application require the owner's separate decision. Neither has happened.
