import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../prisma.js";
import { NotFoundError } from "../lib/errors.js";
import { OAUTH_SCOPES, publicOrigin } from "../lib/oauth.js";
import { OAuthRepository } from "../repositories/oauth.repository.js";
import { OAuthError, OAuthService } from "../services/oauth.service.js";
import { oauthAuthorizeQuerySchema, oauthDecisionSchema, oauthGrantParamsSchema, oauthRegisterSchema, oauthTokenSchema } from "../schemas/oauth.js";

const service = new OAuthService(new OAuthRepository(prisma));

function protectedResourceMetadata() {
  const origin = publicOrigin();
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Abregi",
  };
}

/** OAuth 2.1 authorization server for MCP clients (ChatGPT, Claude…): PKCE, dynamic registration, rotating refresh tokens. */
export async function oauthRoutes(fastify: FastifyInstance) {
  fastify.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  fastify.setErrorHandler(async (error, request, reply) => {
    const isProtocolRoute = request.url.startsWith("/oauth/");
    if (error instanceof OAuthError) {
      return reply.status(error.status).header("cache-control", "no-store").send({ error: error.code, error_description: error.message });
    }
    if (isProtocolRoute && error instanceof ZodError) {
      return reply.status(400).header("cache-control", "no-store").send({ error: "invalid_request", error_description: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
    }
    throw error;
  });

  fastify.get("/.well-known/oauth-protected-resource", { config: { documentation: {} } }, async () => protectedResourceMetadata());

  fastify.get("/.well-known/oauth-protected-resource/mcp", { config: { documentation: {} } }, async () => protectedResourceMetadata());

  fastify.get("/.well-known/oauth-authorization-server", { config: { documentation: {} } }, async () => {
    const origin = publicOrigin();
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      scopes_supported: OAUTH_SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };
  });

  fastify.post("/oauth/register", { config: { documentation: { body: oauthRegisterSchema, statusCodes: [201] } } }, async (request, reply) => {
    const input = oauthRegisterSchema.parse(request.body);
    return reply.status(201).header("cache-control", "no-store").send(await service.register(input));
  });

  fastify.post("/oauth/token", { config: { documentation: { body: oauthTokenSchema } } }, async (request, reply) => {
    const input = oauthTokenSchema.parse(request.body);
    return reply.header("cache-control", "no-store").header("pragma", "no-cache").send(await service.token(input));
  });

  fastify.get("/api/oauth/authorize", { config: { documentation: { querystring: oauthAuthorizeQuerySchema } } }, async (request) => {
    return service.preview(oauthAuthorizeQuerySchema.parse(request.query));
  });

  fastify.post("/api/oauth/authorize", { config: { documentation: { body: oauthDecisionSchema } } }, async (request) => {
    return service.decide(request.user!, oauthDecisionSchema.parse(request.body));
  });

  fastify.get("/api/account/oauth-grants", { config: { documentation: {} } }, async (request) => {
    return service.listGrants(request.user!.id);
  });

  fastify.delete("/api/account/oauth-grants/:id", { config: { documentation: { params: oauthGrantParamsSchema } } }, async (request) => {
    const { id } = oauthGrantParamsSchema.parse(request.params);
    if (!(await service.revokeGrant(id, request.user!.id))) throw new NotFoundError("Application introuvable");
    return { ok: true };
  });
}
