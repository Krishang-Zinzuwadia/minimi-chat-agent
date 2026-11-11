import type { Status } from "./types";
export interface Config {
  mode: Status["mode"];
  model: string;
  baseUrl: string;
  apiKey: string;
  firecrawlKey: string;
  databaseUrl: string;
  timezone: string;
  authMode: "local" | "cloudflare-access";
  accessDomain: string;
  accessAudience: string;
  missing: string[];
}
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const firecrawlKey = env.FIRECRAWL_API_KEY?.trim() ?? "";
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const missing: string[] = [];
  const any = Boolean(apiKey || firecrawlKey || databaseUrl);
  const forceDemo = env.DEMO_MODE === "true";
  if (any && !forceDemo) {
    if (!apiKey) missing.push("OPENAI_API_KEY");
    if (!firecrawlKey) missing.push("FIRECRAWL_API_KEY");
    if (!databaseUrl) missing.push("DATABASE_URL");
  }
  const baseUrl = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      missing.push("Valid HTTPS OPENAI_BASE_URL");
  } catch {
    missing.push("Valid OPENAI_BASE_URL");
  }
  if (databaseUrl && !forceDemo)
    try {
      const url = new URL(databaseUrl);
      if (!["postgresql:", "postgres:"].includes(url.protocol))
        missing.push("Valid DATABASE_URL");
    } catch {
      missing.push("Valid DATABASE_URL");
    }
  let timezone = env.TIMEZONE || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    missing.push("Valid TIMEZONE");
    timezone = "UTC";
  }
  const authMode =
    env.AUTH_MODE === "cloudflare-access" ? "cloudflare-access" : "local";
  if (env.AUTH_MODE && !["local", "cloudflare-access"].includes(env.AUTH_MODE))
    missing.push("Valid AUTH_MODE");
  const accessDomain = (env.CF_ACCESS_TEAM_DOMAIN || "").replace(/\/$/, "");
  const accessAudience = env.CF_ACCESS_AUD || "";
  if (authMode === "cloudflare-access") {
    if (!accessAudience) missing.push("CF_ACCESS_AUD");
    try {
      const url = new URL(accessDomain);
      if (
        url.protocol !== "https:" ||
        !url.hostname.endsWith(".cloudflareaccess.com") ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        missing.push("Valid CF_ACCESS_TEAM_DOMAIN");
    } catch {
      missing.push("CF_ACCESS_TEAM_DOMAIN");
    }
  }
  return {
    mode: missing.length ? "setup" : forceDemo || !any ? "demo" : "live",
    model: env.OPENAI_MODEL || "gpt-6-luna",
    baseUrl,
    apiKey,
    firecrawlKey,
    databaseUrl,
    timezone,
    authMode,
    accessDomain,
    accessAudience,
    missing,
  };
}
export function publicStatus(config: Config, request: Request): Status {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(request.url).hostname,
  );
  const blocked = config.authMode === "local" && !local;
  return {
    mode: blocked ? "setup" : config.mode,
    model: config.model,
    timezone: config.timezone,
    configured: !blocked && config.mode === "live",
    storage: config.mode === "live" ? "neon" : "memory",
    auth: blocked ? "required" : config.authMode,
    missing: blocked
      ? [...config.missing, "Hosted authentication"]
      : config.missing,
  };
}
