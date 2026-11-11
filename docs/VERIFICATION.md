# Verification record

Checked on 11 November 2026 in a Linux environment running Node.js 24.22.1.

## Passed

- `npm install`: completes with no runtime dependencies.
- `npm run check`: every application, browser, script and test JavaScript file passes Node syntax checking.
- `npm test`: **32 tests passed, 0 failed, 0 skipped**.
- `npm run smoke`: launches the actual server entry point in a clean temporary data directory, checks HTTP status, creates a conversation, receives a completed SSE demo answer and reads the saved messages. No external API calls.
- Independent code review and an HTTP cancellation check: disconnect reaches the model abort signal and does not persist a partial assistant answer.
- Review findings fixed with regression tests: freshness wording must not hide an older shortlist, product name “Monday CRM” is not a weekday anchor, and recent source snapshots retain historical IDs instead of colliding with new citations.
- A large-source-history regression confirms the initial model prompt remains within its character budget.

The shell emits an environment-level npm `http-proxy` configuration warning; it does not fail these commands.

## Not verified

- **Live model and search calls:** no OpenAI/Tavily credentials were available or created. Provider adapters are tested with controlled HTTP/SSE fixtures. Real model accuracy, tool decisions, external latency, quotas and billing are not measured.
- **Real browser interaction and visual layout:** headless Chromium was attempted, but the execution environment rejected its required socket operation before a page could open. Browser SSE/parser and safe-link helpers are unit-tested; that is not visual or end-to-end browser verification.
- **Node 22 locally:** verification used Node 24. The GitHub workflow runs the same checks on Node 22 and 24; its current results must be checked separately.
- **Production hosting, multi-user isolation and load behavior:** deliberately outside the local single-user scope.

## Before submitting

1. Configure your own keys through `.env`, run the app and inspect a live dated recheck with original/current sources.
2. Walk through ordinary follow-ups, Stop, provider failure and page reload in a real browser, on desktop and a narrow viewport.
3. Read every module and the design tradeoffs; record the requested one-minute explanation in your own words.
4. Only when ready, separately decide to make the repository public and submit it through the application form. Neither step has been taken here.
