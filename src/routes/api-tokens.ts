import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { NotFoundError } from "../lib/errors.js";
import { ApiTokenRepository } from "../repositories/api-token.repository.js";
import { apiTokenParamsSchema, createApiTokenSchema } from "../schemas/api-token.js";

const repository = new ApiTokenRepository(prisma);

export async function apiTokenRoutes(fastify: FastifyInstance) {
  fastify.get("/api/account/api-tokens", { config: { documentation: {} } }, async (request) => {
    return repository.list(request.user!.id);
  });

  fastify.post("/api/account/api-tokens", { config: { documentation: { body: createApiTokenSchema, statusCodes: [201] } } }, async (request, reply) => {
    const input = createApiTokenSchema.parse(request.body);
    return reply.status(201).send(await repository.create(request.user!.id, input));
  });

  fastify.delete("/api/account/api-tokens/:id", { config: { documentation: { params: apiTokenParamsSchema } } }, async (request) => {
    const { id } = apiTokenParamsSchema.parse(request.params);
    const { count } = await repository.delete(request.user!.id, id);
    if (!count) throw new NotFoundError("Token introuvable");
    return { ok: true };
  });
}
