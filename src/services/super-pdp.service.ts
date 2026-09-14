import { z } from "zod";
import { ValidationError } from "../lib/errors.js";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { decryptCredential, encryptCredential } from "../lib/encrypted-credentials.js";

// Official schema: https://api.superpdp.tech/openapi/superpdp.json
const companySchema = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1)]),
  number: z.string(),
  number_scheme: z.string(),
  env: z.enum(["sandbox", "production"]),
  formal_name: z.string(),
});

export function verifyCompany(payload: unknown, siren: string) {
  const parsed = companySchema.safeParse(payload);
  if (!parsed.success) throw new ValidationError("Impossible de vérifier l'entreprise Super PDP. Reconnectez votre entreprise.");
  const company = parsed.data;
  if (company.env !== "production") throw new ValidationError("Ce compte Super PDP est en sandbox : il ne permet pas de transmettre des factures réelles. Connectez l'entreprise en production.");
  if (company.number_scheme !== "fr_siren" || company.number !== siren) {
    throw new ValidationError("L'entreprise Super PDP ne correspond pas au SIREN de cet espace. Connectez le compte de votre entreprise.");
  }
  return company;
}

export async function getVerifiedCompany(accessToken: string, siren: string) {
  const response = await fetch("https://api.superpdp.tech/v1.beta/companies/me", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new ValidationError("Connexion Super PDP expirée ou non autorisée. Reconnectez votre entreprise.");
  return verifyCompany(await response.json(), siren);
}

export async function workspaceAccessToken(workspaceId: string) {
  return prisma.$transaction(async (tx) => {
    // Token rotation is serialized across application instances.
    await tx.$queryRaw`SELECT id FROM "ElectronicInvoicingConnection" WHERE "workspaceId" = ${workspaceId} AND provider = 'SUPER_PDP' FOR UPDATE`;
    const connection = await tx.electronicInvoicingConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "SUPER_PDP" } } });
    if (!connection?.accessToken || connection.status !== "CONNECTED") throw new ValidationError("Connectez votre entreprise à Super PDP");
    if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() > Date.now() + 60000) return decryptCredential(connection.accessToken);
    if (!connection.refreshToken || !env.SUPER_PDP_CLIENT_ID || !env.SUPER_PDP_CLIENT_SECRET) throw new ValidationError("La connexion Super PDP a expiré. Reconnectez votre entreprise.");
    const response = await fetch(env.SUPER_PDP_TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptCredential(connection.refreshToken), client_id: env.SUPER_PDP_CLIENT_ID, client_secret: env.SUPER_PDP_CLIENT_SECRET }),
      signal: AbortSignal.timeout(10000),
    });
    const token = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.number().positive().optional() }).safeParse(await response.json().catch(() => null));
    if (!response.ok || !token.success) throw new ValidationError("Super PDP n’a pas renouvelé l’autorisation. Reconnectez votre entreprise.");
    await tx.electronicInvoicingConnection.update({ where: { id: connection.id }, data: {
      accessToken: encryptCredential(token.data.access_token),
      refreshToken: token.data.refresh_token ? encryptCredential(token.data.refresh_token) : connection.refreshToken,
      tokenExpiresAt: token.data.expires_in ? new Date(Date.now() + token.data.expires_in * 1000) : null,
    } });
    return token.data.access_token;
  }, { timeout: 15000 });
}
