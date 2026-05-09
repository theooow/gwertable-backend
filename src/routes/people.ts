import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { personSchema } from "../schemas/person.js";
import { PersonDao } from "../dao/person.dao.js";
import { PersonRepository } from "../repositories/person.repository.js";
import { PersonService } from "../services/person.service.js";
import { toPersonDTO } from "../dto/person.dto.js";

const idParamsSchema = z.object({ id: z.string().min(1) });
const workspaceIdParamsSchema = z.object({ workspaceId: z.string().min(1) });
const peopleQuerySchema = z.object({
  search: z.string().optional().default(""),
  tags: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
    ),
  includeArchived: z.coerce.boolean().optional().default(false),
});

const service = new PersonService(
  new PersonRepository(new PersonDao(prisma), prisma),
);

export async function peopleRoutes(fastify: FastifyInstance) {
  fastify.get("/api/people", async (request) => {
    const { search, tags, includeArchived } = peopleQuerySchema.parse(request.query);
    const people = await service.list(request.workspaceId, request.userRole, {
      search: search || undefined,
      tags: tags.length > 0 ? tags : undefined,
      includeArchived,
    });
    return people.map(toPersonDTO);
  });

  fastify.get("/api/workspaces/:workspaceId/people", async (request) => {
    const { workspaceId } = workspaceIdParamsSchema.parse(request.params);
    const people = await service.listForAccessibleWorkspace(
      workspaceId,
      request.userRole,
      request.user!.id,
      request.user!.email,
    );
    return people.map(toPersonDTO);
  });

  fastify.get("/api/people/tags", async (request) => {
    return service.listTags(request.workspaceId, request.userRole);
  });

  fastify.post("/api/people", async (request, reply) => {
    const data = personSchema.parse(request.body);
    const person = await service.create(request.workspaceId, request.userRole, data);
    return reply.status(201).send(toPersonDTO(person));
  });

  fastify.get("/api/people/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const person = await service.get(id, request.workspaceId, request.userRole);
    return toPersonDTO(person);
  });

  fastify.put("/api/people/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = personSchema.parse(request.body);
    const person = await service.update(id, request.workspaceId, request.userRole, data);
    return toPersonDTO(person);
  });

  fastify.post("/api/people/:id/archive", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const person = await service.archive(id, request.workspaceId, request.userRole);
    return toPersonDTO(person);
  });

  fastify.post("/api/people/:id/restore", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const person = await service.restore(id, request.workspaceId, request.userRole);
    return toPersonDTO(person);
  });
}
