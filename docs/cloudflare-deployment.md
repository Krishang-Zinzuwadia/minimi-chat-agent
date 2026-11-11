# Public Cloudflare deployment

Live: https://minimi-chat-agent.krishang.dev

The real vinext build runs on Cloudflare Workers with static assets and Neon PostgreSQL. The custom domain is public. Server APIs use signed, 30-day HttpOnly/Secure/SameSite visitor cookies and strict same-origin writes. Each visitor has a separate database owner; previous Cloudflare Access history remains isolated. Clearing/expiring the cookie loses access to that visitor's history.

Worker secrets: DATABASE_URL, OPENAI_API_KEY, FIRECRAWL_API_KEY, PUBLIC_SESSION_SECRET. Never commit their values. AUTH_MODE is public, PUBLIC_ORIGIN is the custom domain, and the model is fixed to gpt-6-luna. Preview URLs remain disabled; the workers.dev hostname still has owner-only Access and is not the canonical public API origin.

## Abuse controls

Atomic Neon counters cap chats at 6 per visitor/day, 30 globally/day, 300 globally lifetime. Separate model/search counters cap each at 60 globally/day and 600 lifetime. API admission is bounded too. Attempts count before provider work, failures are not refunded, and public model calls have no retries and bounded input/output. Global lifetime fuses do not automatically reset. Shared quotas can be exhausted by public visitors. These are request limits, not a dollar cap, and they do not cap Cloudflare or Neon infrastructure charges.

## Verification November 11, 2026

- TypeScript check and all 70 tests passed; vinext production build passed.
- Independent review found no P0/P1 issues in visitor isolation, origin checks, durable quotas or provider bounds.
- Additive public_limits migration tested on isolated Neon branch, then production. Concurrent admission enforced the exact limit with persisted counters.
- Public homepage/status/bootstrap HTTP 200; status reported live, Neon, public authentication and gpt-6-luna.
- Conversation create HTTP 201; another visitor's read HTTP 404; cross-origin write HTTP 403.
- Real hosted chat used Luna and one Firecrawl search, streamed a cited answer, and persisted two messages in Neon.
- Browser loaded the public interface and displayed Saved with PostgreSQL.

Deployment used Cloudflare MCP for configuration and Worker upload. The initial static assets used its scoped one-hour upload JWT from the runtime because the connector cannot override the asset upload authorization header; later upload reused identical assets. No persistent Cloudflare API credential was created. Temporary deployment credentials were removed.

Future deployments must preserve visitor isolation, durable quotas, secrets, and canonical origin checks. Do not fall back to a shared owner or demo memory for public traffic.
