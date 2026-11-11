import { bindings, defineConfig, defineWorker } from "cf/config";

// Owner-only Cloudflare Access protects the Worker; preview URLs stay disabled.
// These are declarations only: importing/building this file does not deploy it.
export default defineConfig({
  accountId: "22372f05b35ed2d2cf9d27b5a49cf807",
  worker: defineWorker({
    name: "minimi-chat-agent",
    entrypoint: "vinext/server/fetch-handler",
    // >= 2026-08-04 enables Node compatibility by default; this also enables
    // automatic process.env population from text/secret bindings (since 2025-04-01).
    compatibilityDate: "2026-11-11",
    workersDev: true,
    previewUrls: false,
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      AUTH_MODE: bindings.text("cloudflare-access"),
      // Access application audience and issuer are public configuration, not secrets.
      CF_ACCESS_TEAM_DOMAIN: bindings.text("https://lingering-pine-8c86.cloudflareaccess.com"),
      CF_ACCESS_AUD: bindings.text("3c3050be740f1a10e37d10880910cbb3fac0a32548f2db8544e6b5926b6891cf"),
      OPENAI_MODEL: bindings.text("gpt-6-luna"),
      DATABASE_URL: bindings.secret(),
      OPENAI_API_KEY: bindings.secret(),
      FIRECRAWL_API_KEY: bindings.secret(),
    },
  }),
});
