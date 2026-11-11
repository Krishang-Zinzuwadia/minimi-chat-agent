# Cloudflare deployment

Deployed November 11, 2026: https://minimi-chat-agent.krishangzinzuwadia.workers.dev

The real vinext build runs on Cloudflare Workers with static assets. Cloudflare Access protects the Worker destination, permits only the owner email via Cloudflare identity, and verifies issuer/audience again in server API code. Preview URLs remain disabled. DATABASE_URL, OPENAI_API_KEY and FIRECRAWL_API_KEY are encrypted Worker secrets, never repository files. The model is gpt-6-luna.

Verification: `npm run check:cloudflare` passed with 12 supported features, zero issues. `npm run build:vinext` passed. Cloudflare accepted the real modules and 19 static assets. Anonymous `/`, `/api/status`, and `/api/conversations` requests returned HTTP 302 to Cloudflare Access; browser displayed the owner login screen. Authenticated hosted chat/search still requires owner sign-in for end-to-end verification. Do not remove Access to test.

Deployment used Cloudflare MCP for resource configuration and Worker upload. The scoped, one-hour Cloudflare asset-upload JWT was used from the runtime for asset transfer because the connector request interface cannot override the upload authorization header. No persistent Cloudflare API token was created.

For future deployment, build first, preserve the existing Access Worker destination and owner-only policy, bind secrets securely, then verify authenticated and anonymous behavior. Never publish `.env.local`, authentication files, or secret values.
