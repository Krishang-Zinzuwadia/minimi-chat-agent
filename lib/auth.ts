import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Config } from "./config";
import { AppError } from "./errors";
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function authorize(
  request: Request,
  config: Config,
): Promise<string> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const loopback = (hostname: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  let requestOrigin = url.origin;
  if (host) {
    let actual: URL;
    try {
      actual = new URL(`${url.protocol}//${host}`);
    } catch {
      throw new AppError(403, "Request host does not match.");
    }
    // NextURL canonicalizes 127.0.0.1 to localhost. Preserve the browser's real
    // origin while accepting only loopback aliases on the same port.
    const matches =
      actual.host === url.host ||
      (loopback(actual.hostname) &&
        loopback(url.hostname) &&
        actual.port === url.port);
    if (
      !matches ||
      actual.username ||
      actual.password ||
      actual.pathname !== "/" ||
      actual.search ||
      actual.hash
    )
      throw new AppError(403, "Request host does not match.");
    requestOrigin = actual.origin;
  }
  if (
    (origin && origin !== requestOrigin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AppError(403, "Cross-origin requests are not allowed.");
  if (config.authMode === "local") {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new AppError(
        503,
        "Hosted authentication is not configured. Local mode only accepts loopback requests.",
      );
    return "local-dev";
  }
  if (config.missing.some((name) => name.includes("CF_ACCESS")))
    throw new AppError(503, "Cloudflare Access is not configured.");
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token)
    throw new AppError(401, "Please sign in through Cloudflare Access.");
  try {
    let jwks = keysets.get(config.accessDomain);
    if (!jwks) {
      jwks = createRemoteJWKSet(
        new URL("/cdn-cgi/access/certs", config.accessDomain),
        { timeoutDuration: 5000 },
      );
      if (keysets.size >= 8) keysets.clear();
      keysets.set(config.accessDomain, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.accessDomain,
      audience: config.accessAudience,
      algorithms: ["RS256"],
      clockTolerance: 5,
      requiredClaims: ["sub", "exp", "iat"],
    });
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.sub.length > 200
    )
      throw new Error();
    return `cf:${payload.sub}`;
  } catch {
    throw new AppError(401, "Please sign in through Cloudflare Access.");
  }
}
