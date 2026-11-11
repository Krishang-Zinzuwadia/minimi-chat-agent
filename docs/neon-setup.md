# Neon PostgreSQL setup

The app uses its existing `@neondatabase/serverless` HTTP driver from server-side route handlers. Database credentials never reach the browser. Hosted operation still requires Cloudflare Access.

## Current integration

The requested project is `lingering-leaf-80745206`, production branch `br-lively-haze-aopdjv1s`, database `neondb`. The Neon connector was used after CLI OAuth callbacks repeatedly timed out. The CLI's offline `.neon` link alone was not treated as proof of provisioning.

The production database had no application tables before setup. The checked-in additive schema was first applied and tested on the isolated `minimi-setup-verification` branch, then applied to production. No existing tables or data were deleted. The verification branch remains available for inspection; synthetic verification records are retained.

Private `.env.local` holds the pooled `DATABASE_URL` for app traffic and direct `DATABASE_URL_UNPOOLED` for migrations. Both `.env` and `.env.local` are ignored by Git. Next.js loads these automatically; migration commands use the same Next environment loader.

`neon.ts` declares no optional Neon services. PostgreSQL already exists in the specified project; no auth, storage, functions or AI gateway were added. The app continues to use the specified external AI and search providers.

## Reproducible checks

```sh
npm run db:migrate
npm run build
npm run check
npm test
node --env-file=.env.local --import tsx scripts/neon-verify.ts
```

The live verification script creates synthetic records with a unique verification owner and tests persistence across store instances, owner isolation, recent questions, lexical recall and leases. It never deletes existing records. Run against a development branch when possible.

## Verified November 11, 2026

- `npm run build`: Compiled successfully; dynamic application and API routes generated.
- `npm run check`: exit code 0.
- `npm test`: 65 tests, 65 pass, 0 fail.
- Live Neon verification: passed persistence, reload, owner isolation, recent questions, lexical recall and atomic leases on verification and production branches.
- Running compiled Next app: API conversation creation, read and list persisted through production Neon successfully.

The HTTP database check used inert OpenAI/Firecrawl configuration solely to enable the app's live database route selection; it made no AI/search requests. This is **not** verification of OpenAI or Firecrawl, nor proof of a Cloudflare deployment. Live provider tests and hosted Access authentication must be verified separately.

`npm run smoke` uses explicitly isolated demo mode. It verifies UI/API wiring but not external connectivity. Never commit `.env`, `.env.local`, CLI authentication files, or production secrets.
