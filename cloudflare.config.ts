import { bindings, defineConfig, defineWorker } from "cf/config";

// Keep all public routes disabled until Access, secrets and smoke tests are ready.
// These are declarations only: importing/building this file does not deploy it.
export default defineConfig({
  accountId: "22372f05b35ed2d2cf9d27b5a49cf807",
  worker: defineWorker({
    name: "minimi-chat-agent",
    entrypoint: "vinext/server/fetch-handler",
    // >= 2026-08-04 enables Node compatibility by default; this also enables
    // automatic process.env population from text/secret bindings (since 2025-04-01).
    compatibilityDate: "2026-11-11",
    workersDev: false,
    previewUrls: false,
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      AUTH_MODE: bindings.text("cloudflare-access"),
      // Replace these non-secret values after configuring the Access application.
      // Empty values deliberately leave authenticated APIs unavailable.
      CF_ACCESS_TEAM_DOMAIN: bindings.text(""),
      CF_ACCESS_AUD: bindings.text(""),
      OPENAI_MODEL: bindings.text("gpt-6-luna"),
      DATABASE_URL: bindings.secret(),
      OPENAI_API_KEY: bindings.secret(),
      FIRECRAWL_API_KEY: bindings.secret(),
    },
  }),
});
