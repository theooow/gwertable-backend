import { createHash } from "node:crypto";
import { randomToken } from "./token.js";

/** Distinguishes personal API tokens from browser session tokens in `Authorization: Bearer`. */
export const API_TOKEN_PREFIX = "abr_";

export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomToken(32)}`;
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isApiToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}

/** API tokens cannot reach platform administration, mint or revoke tokens, nor delete their account. */
export function isApiTokenForbiddenRoute(method: string, url: string): boolean {
  const path = url.split("?")[0];
  return path.startsWith("/api/admin") || path.startsWith("/api/account/api-tokens") || (method === "DELETE" && path === "/api/account");
}
