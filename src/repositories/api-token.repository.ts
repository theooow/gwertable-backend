import type { PrismaClient } from "@prisma/client";
import { generateApiToken, hashApiToken } from "../lib/api-token.js";
import type { CreateApiTokenInput } from "../schemas/api-token.js";

const publicFields = { id: true, name: true, tokenPrefix: true, scope: true, lastUsedAt: true, expiresAt: true, createdAt: true } as const;

export class ApiTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(userId: string) {
    return this.prisma.apiToken.findMany({ where: { userId, grantId: null }, select: publicFields, orderBy: { createdAt: "desc" } });
  }

  /** Returns the clear token once; only its hash is persisted. */
  async create(userId: string, input: CreateApiTokenInput) {
    const token = generateApiToken();
    const created = await this.prisma.apiToken.create({
      data: {
        userId,
        name: input.name,
        scope: input.scope,
        tokenHash: hashApiToken(token),
        tokenPrefix: token.slice(0, 12),
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
      },
      select: publicFields,
    });
    return { ...created, token };
  }

  delete(userId: string, id: string) {
    return this.prisma.apiToken.deleteMany({ where: { id, userId, grantId: null } });
  }
}
