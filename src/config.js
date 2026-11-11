import { resolve } from "node:path";
export function loadConfig(env = process.env) {
  const apiKey = env.OPENAI_API_KEY?.trim() || "";
  const searchKey = env.TAVILY_API_KEY?.trim() || "";
  const forceDemo = env.DEMO_MODE === "true" || process.argv.includes("--demo");
  if (!forceDemo && Boolean(apiKey) !== Boolean(searchKey))
    throw new Error(
      "Configure both OPENAI_API_KEY and TAVILY_API_KEY, or use DEMO_MODE=true.",
    );
  const baseUrl = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Model base URL cannot include credentials, query parameters, or fragments.",
    );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error(
      "Model base URL must use HTTPS (HTTP is allowed only for local models).",
    );
  const timezone = env.TIMEZONE || "UTC";
  new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be 1–65535.");
  return {
    apiKey,
    searchKey,
    baseUrl,
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    mode: forceDemo || !apiKey ? "demo" : "live",
    timezone,
    port,
    dataDir: resolve(env.DATA_DIR || "data"),
  };
}
