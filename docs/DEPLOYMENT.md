# Cloudflare deployment runbook

## Architecture and current status

One Worker serves the Next.js TypeScript UI and App Router API handlers through
vinext. Neon Postgres uses `@neondatabase/serverless` HTTP queries; OpenAI Responses
and Firecrawl requests run only on the server. There is no separate API service,
Pages project, Hyperdrive, persistent filesystem, or shared chat-response cache.

The root layout reads the validated appearance cookie and is force-dynamic.
Theme-specific HTML is private/no-store; do not add an edge cache in front of it.
Personalized suggestions use the existing authenticated Neon history and require
no additional provider, credentials or database migration.

**Nothing has been deployed.** Both `workersDev` and `previewUrls` are disabled in
`cloudflare.config.ts`, with no custom-domain route. Keep them disabled until the
release checklist below is complete. The private GitHub repository stays private.

Read-only account inspection on 2026-11-11 confirmed account
`22372f05b35ed2d2cf9d27b5a49cf807` and the `krishangzinzuwadia.workers.dev`
subdomain. No existing Minimi Worker or Pages project was found. The proposed URL
`minimi-chat-agent.krishangzinzuwadia.workers.dev` is not a live deployment.

## Build toolchain

Use Node 22.13+ as specified in package.json and a committed npm lockfile. Keep
`npm run dev` running `next dev --hostname 127.0.0.1` and `npm run build` running
`next build`. Cloudflare has a separate Vite build; a successful Next build alone
does not prove Workers compatibility.

Cloudflare currently recommends vinext for new Next.js apps. vinext and the new
Cloudflare CLI/Vite integration are beta: test the pinned versions before every
release rather than assuming full Next.js parity. Configuration follows the
published vinext 1.4.5 initializer, with caches and Cloudflare Images disabled.
Do not register `@vitejs/plugin-rsc` separately; vinext registers it.

Required additional dependencies:

- Runtime: `vinext@1.4.5`, `@vinext/cloudflare@1.3.4`,
  `react-server-dom-webpack` at the same exact version as `react` and `react-dom`
  (all three must satisfy vinext's `^19.3.1` peer requirement).
- Development: `vite@8.3.8`, `@cloudflare/vite-plugin@2.0.0-beta.v.14`,
  `cf@1.0.0-beta.29`, `@vitejs/plugin-react@6.3.0`, `@vitejs/plugin-rsc@0.5.39`.

Additional package scripts:

```json
{
  "check:cloudflare": "vinext check",
  "dev:vinext": "vite dev --host 127.0.0.1 --port 3001",
  "build:vinext": "vite build",
  "start:vinext": "vite preview --host 127.0.0.1",
  "deploy:vinext": "vinext-cloudflare deploy"
}
```

Include `.cloudflare/types` in tsconfig.json. Exclude `.cloudflare`, `.vinext`,
`dist`, `.next`, `.dev.vars*` and local `.env*` files from Git; retain only a
credential-free `.env.example`. Exclude generated directories from linting.
Do not add a Wrangler config alongside this `cf` configuration.

Local checks after installing dependencies (no deployment):

```sh
npm ci
npm run check:cloudflare
npm run test
npm run check
npm run build
npm run build:vinext
npm run start:vinext
```

Configuration verification on 2026-11-11: `vinext check` reported 12 supported,
0 partial and 0 issues, and `vite build` completed successfully with the UI and
API handlers. The final report had 12 supported items. The build emitted non-fatal framework sourcemap and
chunking warnings. A loopback `vite preview` attempt could not start in the
restricted workspace: Node's `os.networkInterfaces()` failed with
`uv_interface_addresses` / `ERR_SYSTEM_ERROR` inside Cloudflare's inspector-port
selection. Consequently this check did not verify HTTP responses or streaming.

The pinned Workers compatibility date `2026-11-11` enables Node compatibility
automatically. Text and secret bindings populate `process.env` at runtime; that
behavior has been default with Node compatibility since `2025-04-01`. No extra
`nodejs_compat` or `nodejs_compat_populate_process_env` flag is required. Provider
configuration must be read server-side at request time, not embedded into client
bundles or evaluated as a required build-time credential.

The Vite build generates Cloudflare types. If a standalone typecheck needs them
first, run `npx cf workers types`. Missing provider credentials must not require
remote requests during a build. A local build/preview is not a production
authentication or live-provider verification.

## Authentication and secrets

`AUTH_MODE=local` is for loopback-only Node development. Do not use it in hosted
configuration, preview deployments, tunnels, or network-exposed dev servers.
The checked-in Worker configuration fixes `AUTH_MODE=cloudflare-access`.

**Access is not enabled on this Cloudflare account.** Read-only organization and
application requests returned HTTP 403, code 9999,
`access.api.error.not_enabled`. Enable Zero Trust/Access with the account owner,
configure a self-hosted application protecting all production and preview
traffic, and restrict its policy to explicitly approved users. Do not enable a
public hostname first and add authentication afterward.

After creating the Access application, set these non-secret config values:

- `CF_ACCESS_TEAM_DOMAIN`: the exact HTTPS team origin, such as
  `https://YOUR-TEAM.cloudflareaccess.com`.
- `CF_ACCESS_AUD`: the application's audience identifier.

API authorization must validate the Access JWT signature, issuer, audience and
expiry with jose; the mere presence of an Access header is not authentication.
Missing configuration or invalid tokens must fail closed. Scope every history
read/write to the authenticated identity. Validate ownership for conversation
IDs, enforce same-origin mutation checks, and apply server-side input, history,
tool-call, output-token and usage limits before allowing live generation.

Provision these secrets securely in the Worker, not in source or browser code:

- `DATABASE_URL`: the Neon connection string for this application's database.
- `OPENAI_API_KEY`: the authorized OpenAI project key.
- `FIRECRAWL_API_KEY`: the authorized Firecrawl key.

`bindings.secret()` only declares required names; it does not create or store
credentials. The owner will supply them later through an approved secure setup
flow or Cloudflare dashboard secret inputs. Never paste values into this
runbook, chat, shell command arguments, logs, commit history, screenshots or
`NEXT_PUBLIC_*` variables. Keep development values in ignored local files.

`OPENAI_MODEL=gpt-6-luna` is server-side configuration. Verify the supplied
project's actual model access with a small authorized request before release.
The app enforces one active turn per owner and 60 admitted turns per UTC day
across Worker instances. Failed and aborted admitted turns still count. Set
provider-side project budgets too; a request cap is not a currency budget.

Apply the repository's database migration to the correct Neon database only
after connection setup; do not automatically migrate during build or startup.

## Release checklist

1. Complete local type, test, Next production and Workers production builds.
2. Review the vinext compatibility report and resolve all critical findings.
3. Configure Access, audience/team settings, ownership isolation and usage caps.
4. Provision all three secrets securely and run the reviewed database migration.
5. Verify SSE streaming, cancellation, errors, search citations and persisted
   history against the Workers runtime. Test two identities to reject cross-user
   history reads and mutations. Test absent, forged, expired and wrong-audience
   tokens; none may invoke paid APIs or return history.
6. Confirm the hosting plan and expected provider budgets. The Cloudflare OAuth
   connector cannot read billing subscriptions (HTTP 403; endpoint has no OAuth
   scope), so this account's plan is unverified. Free Workers allow 100,000
   requests/day, 10ms CPU/request and 128MB memory; the paid plan starts at
   USD 5/month. No plan upgrade or purchase has been made.
7. Only after approval and protection are ready, enable the intended hostname
   in reviewed configuration. Keep preview URLs disabled unless equally protected.
8. The owner can authenticate the CLI with `npx cf auth login` when deployment is
   authorized. The connector session does not imply the CLI is authenticated.
   Build with `npm run build:vinext`, then deploy with `npm run deploy:vinext`.
   This command uploads the application; do not run it as a build check.
9. Verify the live hostname redirects unauthenticated visitors to Access and
   rejects unauthenticated APIs before sending real chat content. Then test an
   approved identity and record the deployed version for rollback.

## References

- [Next.js on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Non-destructive vinext migration](https://developers.cloudflare.com/workers/static-assets/migration-guides/vercel-to-workers/nextjs/)
- [Cloudflare CLI for agents](https://developers.cloudflare.com/cf/agents/)
- [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Neon HTTP driver](https://neon.com/docs/serverless/serverless-driver)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## Dependency security

Vite is pinned to patched 8.3.8. The lockfile overrides the transitive `fflate`
dependency to its compatible security patch 0.7.5, rather than downgrading
vinext. `npm audit` reported zero vulnerabilities on 2026-11-11. Recheck advisories
before release; this result is time-specific.
