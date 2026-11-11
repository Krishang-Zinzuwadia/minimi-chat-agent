import { defineConfig, devices } from "@playwright/test";

/** A dedicated demo server is mandatory: never attach browser tests to a live workspace. */
export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    reducedMotion: "reduce",
    timezoneId: "UTC",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100/api/status",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DEMO_MODE: "true",
      AUTH_MODE: "local",
      OPENAI_API_KEY: "",
      FIRECRAWL_API_KEY: "",
      DATABASE_URL: "",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      CF_ACCESS_TEAM_DOMAIN: "",
      CF_ACCESS_AUD: "",
      TIMEZONE: "UTC",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
