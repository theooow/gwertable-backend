import type { ApiTokenScope, PrismaClient } from "@prisma/client";
import { generateApiToken, hashApiToken } from "../lib/api-token.js";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS, sha256 } from "../lib/oauth.js";
import { randomToken } from "../lib/token.js";

export class OAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  createClient(name: string, redirectUris: string[]) {
    return this.prisma.oAuthClient.create({ data: { name, redirectUris } });
  }

  findClient(id: string) {
    return this.prisma.oAuthClient.findUnique({ where: { id } });
  }

  async createCode(data: { clientId: string; userId: string; redirectUri: string; codeChallenge: string; scope: ApiTokenScope; expiresAt: Date }) {
    const code = randomToken(32);
    await this.prisma.oAuthAuthorizationCode.create({ data: { ...data, codeHash: sha256(code) } });
    return code;
  }

  /** Codes are single-use: the row is deleted whether or not the exchange succeeds. */
  async consumeCode(code: string) {
    const found = await this.prisma.oAuthAuthorizationCode.findUnique({
      where: { codeHash: sha256(code) },
      include: { user: { select: { usagePlan: true, archivedAt: true } } },
    });
    if (found) await this.prisma.oAuthAuthorizationCode.delete({ where: { id: found.id } });
    return found;
  }

  findGrantByRefreshToken(refreshToken: string) {
    return this.prisma.oAuthGrant.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      include: { user: { select: { usagePlan: true, archivedAt: true } }, client: { select: { name: true } } },
    });
  }

  async createGrant(clientId: string, userId: string, scope: ApiTokenScope) {
    const refreshToken = randomToken(32);
    const grant = await this.prisma.oAuthGrant.create({
      data: { clientId, userId, scope, refreshTokenHash: sha256(refreshToken), refreshExpiresAt: refreshExpiry() },
      include: { client: { select: { name: true } } },
    });
    return { grant, refreshToken };
  }

  /** Rotates the refresh token and drops expired access tokens of the grant. */
  async rotateGrant(id: string) {
    const refreshToken = randomToken(32);
    const now = new Date();
    const [grant] = await this.prisma.$transaction([
      this.prisma.oAuthGrant.update({
        where: { id },
        data: { refreshTokenHash: sha256(refreshToken), refreshExpiresAt: refreshExpiry(), lastUsedAt: now },
        include: { client: { select: { name: true } } },
      }),
      this.prisma.apiToken.deleteMany({ where: { grantId: id, expiresAt: { lt: now } } }),
    ]);
    return { grant, refreshToken };
  }

  async issueAccessToken(grant: { id: string; userId: string; scope: ApiTokenScope; client: { name: string } }) {
    const token = generateApiToken();
    await this.prisma.apiToken.create({
      data: {
        userId: grant.userId,
        grantId: grant.id,
        name: grant.client.name,
        scope: grant.scope,
        tokenHash: hashApiToken(token),
        tokenPrefix: token.slice(0, 12),
        expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return token;
  }

  deleteGrant(id: string) {
    return this.prisma.oAuthGrant.delete({ where: { id } });
  }

  listGrants(userId: string) {
    return this.prisma.oAuthGrant.findMany({
      where: { userId },
      select: { id: true, scope: true, createdAt: true, lastUsedAt: true, client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  revokeGrant(id: string, userId: string) {
    return this.prisma.oAuthGrant.deleteMany({ where: { id, userId } });
  }
}

function refreshExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);
}
