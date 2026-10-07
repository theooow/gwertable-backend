import type { ApiTokenScope, UsagePlan } from "@prisma/client";
import { z } from "zod";
import { ForbiddenError, ValidationError } from "../lib/errors.js";
import { planCan } from "../lib/usage-plans.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  isAllowedRedirectUri,
  matchesRedirectUri,
  scopeToTokenScope,
  tokenScopeToScope,
  verifyPkce,
} from "../lib/oauth.js";
import type { OAuthRepository } from "../repositories/oauth.repository.js";
import type { OAuthAuthorizeQuery, oauthRegisterSchema, oauthTokenSchema } from "../schemas/oauth.js";

/** RFC 6749 §5.2 error, rendered as `{ error, error_description }` by the OAuth routes. */
export class OAuthError extends Error {
  constructor(readonly code: string, description: string, readonly status = 400) {
    super(description);
  }
}

type Account = { usagePlan: UsagePlan; archivedAt: Date | null };

function requireAgentsPlan(user: Account) {
  if (user.archivedAt || !planCan(user.usagePlan, "ai.agents")) {
    throw new OAuthError("invalid_grant", "Les agents IA nécessitent le plan Platinium.");
  }
}

export class OAuthService {
  constructor(private readonly repository: OAuthRepository) {}

  async register(input: z.infer<typeof oauthRegisterSchema>) {
    const invalid = input.redirect_uris.find((uri) => !isAllowedRedirectUri(uri));
    if (invalid) throw new OAuthError("invalid_redirect_uri", `URI de redirection non autorisée : ${invalid}`);
    const client = await this.repository.createClient(input.client_name ?? "Agent IA", input.redirect_uris);
    return {
      client_id: client.id,
      client_name: client.name,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  /** Validates an authorization request before showing the consent screen. */
  async preview(query: OAuthAuthorizeQuery) {
    const client = await this.repository.findClient(query.client_id);
    if (!client) throw new ValidationError("Application inconnue");
    if (!matchesRedirectUri(client.redirectUris, query.redirect_uri)) throw new ValidationError("Adresse de retour non autorisée pour cette application");
    return { clientName: client.name, requestsWrite: scopeToTokenScope(query.scope) === "WRITE" };
  }

  async decide(user: { id: string; usagePlan: UsagePlan }, query: OAuthAuthorizeQuery & { approve: boolean; allowWrite: boolean }) {
    await this.preview(query);
    const redirect = new URL(query.redirect_uri);
    if (query.state) redirect.searchParams.set("state", query.state);
    if (!query.approve) {
      redirect.searchParams.set("error", "access_denied");
      return { redirectTo: redirect.toString() };
    }
    if (!planCan(user.usagePlan, "ai.agents")) throw new ForbiddenError("Les agents IA nécessitent le plan Platinium.");
    const scope: ApiTokenScope = query.allowWrite && scopeToTokenScope(query.scope) === "WRITE" ? "WRITE" : "READ";
    const code = await this.repository.createCode({
      clientId: query.client_id,
      userId: user.id,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      scope,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
    });
    redirect.searchParams.set("code", code);
    return { redirectTo: redirect.toString() };
  }

  async token(input: z.infer<typeof oauthTokenSchema>) {
    if (input.grant_type === "authorization_code") {
      const code = await this.repository.consumeCode(input.code);
      if (!code || code.expiresAt <= new Date() || code.clientId !== input.client_id || code.redirectUri !== input.redirect_uri) {
        throw new OAuthError("invalid_grant", "Code d'autorisation invalide ou expiré");
      }
      if (!verifyPkce(input.code_verifier, code.codeChallenge)) throw new OAuthError("invalid_grant", "Vérificateur PKCE invalide");
      requireAgentsPlan(code.user);
      const { grant, refreshToken } = await this.repository.createGrant(code.clientId, code.userId, code.scope);
      return this.tokenResponse(grant, refreshToken);
    }

    const grant = await this.repository.findGrantByRefreshToken(input.refresh_token);
    if (!grant || grant.clientId !== input.client_id) throw new OAuthError("invalid_grant", "Jeton de rafraîchissement invalide");
    if (grant.refreshExpiresAt <= new Date()) {
      await this.repository.deleteGrant(grant.id);
      throw new OAuthError("invalid_grant", "Jeton de rafraîchissement expiré");
    }
    requireAgentsPlan(grant.user);
    const rotated = await this.repository.rotateGrant(grant.id);
    return this.tokenResponse(rotated.grant, rotated.refreshToken);
  }

  listGrants(userId: string) {
    return this.repository.listGrants(userId);
  }

  async revokeGrant(id: string, userId: string) {
    const { count } = await this.repository.revokeGrant(id, userId);
    return count > 0;
  }

  private async tokenResponse(grant: { id: string; userId: string; scope: ApiTokenScope; client: { name: string } }, refreshToken: string) {
    return {
      access_token: await this.repository.issueAccessToken(grant),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: tokenScopeToScope(grant.scope),
    };
  }
}
