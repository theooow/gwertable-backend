import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { encryptCredential } from "../lib/encrypted-credentials.js";
import { ForbiddenError, ValidationError } from "../lib/errors.js";
import { requireCan } from "../lib/permissions.js";
import { randomToken } from "../lib/token.js";

const legalEntitySchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  siren: z.string().trim().regex(/^\d{9}$/).optional().or(z.literal("")),
  siret: z.string().trim().regex(/^\d{14}$/).optional().or(z.literal("")),
  vatNumber: z.string().trim().max(32).optional().or(z.literal("")),
  peppolEndpoint: z.string().trim().max(200).optional().or(z.literal("")),
  peppolEndpointScheme: z.string().trim().max(32).optional().or(z.literal("")),
  addressLine1: z.string().trim().max(240).optional().or(z.literal("")),
  addressLine2: z.string().trim().max(240).optional().or(z.literal("")),
  postalCode: z.string().trim().max(20).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("FR"),
});

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(32),
});

function nullable(value: string | undefined) {
  return value || null;
}

function requireSuperPdpOAuthConfig() {
  const missing = [
    ["SUPER_PDP_CLIENT_ID", env.SUPER_PDP_CLIENT_ID],
    ["SUPER_PDP_CLIENT_SECRET", env.SUPER_PDP_CLIENT_SECRET],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new ValidationError(`Configuration Super PDP incomplète : ${missing.join(", ")}`);
}

function connectionView(connection: {
  status: string; providerOrgId: string | null; tokenExpiresAt: Date | null;
  lastError: string | null; connectedAt: Date | null;
} | null) {
  return connection && {
    provider: "SUPER_PDP" as const,
    status: connection.status,
    providerOrgId: connection.providerOrgId,
    tokenExpiresAt: connection.tokenExpiresAt,
    lastError: connection.lastError,
    connectedAt: connection.connectedAt,
  };
}

export async function electronicInvoicingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/workspace/electronic-invoicing", async (request) => {
    requireCan(request.userRole, "user.manage");
    const [legalEntity, connection] = await Promise.all([
      prisma.legalEntity.findUnique({ where: { workspaceId: request.workspaceId } }),
      prisma.electronicInvoicingConnection.findUnique({
        where: { workspaceId_provider: { workspaceId: request.workspaceId, provider: "SUPER_PDP" } },
      }),
    ]);
    return { legalEntity, superPdp: connectionView(connection) };
  });

  fastify.put("/api/workspace/electronic-invoicing/legal-entity", async (request) => {
    requireCan(request.userRole, "user.manage");
    const data = legalEntitySchema.parse(request.body);
    return {
      legalEntity: await prisma.legalEntity.upsert({
        where: { workspaceId: request.workspaceId },
        create: {
          workspaceId: request.workspaceId,
          legalName: data.legalName,
          siren: nullable(data.siren), siret: nullable(data.siret), vatNumber: nullable(data.vatNumber), peppolEndpoint: nullable(data.peppolEndpoint), peppolEndpointScheme: nullable(data.peppolEndpointScheme),
          addressLine1: nullable(data.addressLine1), addressLine2: nullable(data.addressLine2),
          postalCode: nullable(data.postalCode), city: nullable(data.city), countryCode: data.countryCode,
        },
        update: {
          legalName: data.legalName,
          siren: nullable(data.siren), siret: nullable(data.siret), vatNumber: nullable(data.vatNumber), peppolEndpoint: nullable(data.peppolEndpoint), peppolEndpointScheme: nullable(data.peppolEndpointScheme),
          addressLine1: nullable(data.addressLine1), addressLine2: nullable(data.addressLine2),
          postalCode: nullable(data.postalCode), city: nullable(data.city), countryCode: data.countryCode,
        },
      }),
    };
  });

  fastify.post("/api/workspace/electronic-invoicing/super-pdp/connect", async (request) => {
    requireCan(request.userRole, "user.manage");
    requireSuperPdpOAuthConfig();
    const legalEntity = await prisma.legalEntity.findUnique({ where: { workspaceId: request.workspaceId } });
    if (!legalEntity?.siren) throw new ValidationError("Renseignez le SIREN de l'entité légale avant de connecter Super PDP");

    const state = randomToken();
    await prisma.electronicInvoicingOAuthState.create({
      data: {
        workspaceId: request.workspaceId, userId: request.user!.id, provider: "SUPER_PDP", state,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    const url = new URL(env.SUPER_PDP_AUTHORIZATION_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", env.SUPER_PDP_CLIENT_ID!);
    url.searchParams.set("redirect_uri", env.SUPER_PDP_REDIRECT_URI);
    url.searchParams.set("state", state);
    if (env.SUPER_PDP_SCOPES) url.searchParams.set("scope", env.SUPER_PDP_SCOPES);
    return { authorizationUrl: url.toString() };
  });

  // This endpoint is only called server-to-server by the public Next.js callback.
  fastify.post("/api/workspace/electronic-invoicing/super-pdp/callback", async (request) => {
    const { code, state } = callbackSchema.parse(request.body);
    const oauthState = await prisma.electronicInvoicingOAuthState.findUnique({ where: { state } });
    if (!oauthState || oauthState.provider !== "SUPER_PDP" || oauthState.consumedAt || oauthState.expiresAt <= new Date()) {
      throw new ValidationError("La demande de connexion Super PDP est invalide ou expirée");
    }
    if (oauthState.userId !== request.user!.id) throw new ForbiddenError("Cette connexion ne vous appartient pas");
    if (oauthState.workspaceId !== request.workspaceId) throw new ForbiddenError("La connexion ne correspond pas à l'espace actif");
    requireCan(request.userRole, "user.manage");
    requireSuperPdpOAuthConfig();

    await prisma.electronicInvoicingOAuthState.update({ where: { id: oauthState.id }, data: { consumedAt: new Date() } });
    const response = await fetch(env.SUPER_PDP_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, client_id: env.SUPER_PDP_CLIENT_ID!,
        client_secret: env.SUPER_PDP_CLIENT_SECRET!, redirect_uri: env.SUPER_PDP_REDIRECT_URI,
      }),
    });
    const payload = await response.json().catch(() => null) as {
      access_token?: string; refresh_token?: string; expires_in?: number; organization_id?: string; org_id?: string;
    } | null;
    if (!response.ok || !payload?.access_token) {
      await prisma.electronicInvoicingConnection.upsert({
        where: { workspaceId_provider: { workspaceId: request.workspaceId, provider: "SUPER_PDP" } },
        create: { workspaceId: request.workspaceId, provider: "SUPER_PDP", status: "ERROR", lastError: "Échec de l'autorisation Super PDP" },
        update: { status: "ERROR", lastError: "Échec de l'autorisation Super PDP" },
      });
      throw new ValidationError("Super PDP a refusé l'autorisation");
    }
    const company = await fetch("https://api.superpdp.tech/v1.beta/companies/me", {
      headers: { authorization: `Bearer ${payload.access_token}`, accept: "application/json" },
    }).then(async (companyResponse) => companyResponse.ok ? companyResponse.json() as Promise<{ id?: string | number }> : null)
      .catch(() => null);
    const tokenExpiresAt = payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null;
    await prisma.electronicInvoicingConnection.upsert({
      where: { workspaceId_provider: { workspaceId: request.workspaceId, provider: "SUPER_PDP" } },
      create: { workspaceId: request.workspaceId, provider: "SUPER_PDP", status: "CONNECTED", providerOrgId: company?.id ? String(company.id) : payload.organization_id ?? payload.org_id ?? null, accessToken: encryptCredential(payload.access_token), refreshToken: payload.refresh_token ? encryptCredential(payload.refresh_token) : null, tokenExpiresAt, connectedAt: new Date(), lastError: null },
      update: { status: "CONNECTED", providerOrgId: company?.id ? String(company.id) : payload.organization_id ?? payload.org_id ?? null, accessToken: encryptCredential(payload.access_token), refreshToken: payload.refresh_token ? encryptCredential(payload.refresh_token) : null, tokenExpiresAt, connectedAt: new Date(), lastError: null },
    });
    return { ok: true };
  });
}
