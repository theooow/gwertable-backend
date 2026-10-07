import { createHash } from "node:crypto";
import { env } from "../env.js";

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_DAYS = 90;
export const AUTHORIZATION_CODE_TTL_SECONDS = 300;
export const OAUTH_SCOPES = ["read", "write"] as const;

/** Public origin: the frontend proxies /mcp, /oauth and /.well-known to the backend. */
export function publicOrigin(): string {
  return env.FRONTEND_URL.replace(/\/+$/, "");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Registered redirect URIs must be HTTPS, or HTTP on loopback for desktop and CLI clients. */
export function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.hash && (url.protocol === "https:" || isLoopback(url));
  } catch {
    return false;
  }
}

/** Loopback redirects may use any port (RFC 8252 §7.3); other URIs must match exactly. */
export function matchesRedirectUri(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  try {
    const url = new URL(requested);
    if (!isLoopback(url)) return false;
    return registered.some((candidate) => {
      const allowed = new URL(candidate);
      return isLoopback(allowed) && allowed.hostname === url.hostname && allowed.pathname === url.pathname;
    });
  } catch {
    return false;
  }
}

export function scopeToTokenScope(scope: string | undefined): "READ" | "WRITE" {
  return scope?.split(/\s+/).includes("write") ? "WRITE" : "READ";
}

export function tokenScopeToScope(scope: "READ" | "WRITE"): string {
  return scope === "WRITE" ? "read write" : "read";
}
