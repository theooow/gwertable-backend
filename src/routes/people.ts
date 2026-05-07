import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireCan } from "../lib/permissions.js";
import { personSchema } from "../schemas/person.js";

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

export async function peopleRoutes(fastify: FastifyInstance) {
  fastify.get("/api/people", async (request) => {
    requireCan(request.userRole, "person.read");
    const { search, tags, includeArchived } = peopleQuerySchema.parse(request.query);

    const where: Prisma.PersonWhereInput = {
      workspaceId: request.workspaceId,
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { tags: { hasSome: [search.toLowerCase()] } },
            ],
          }
        : {}),
      ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
    };

    return prisma.person.findMany({
      where,
      orderBy: { fullName: "asc" },
    });
  });

  fastify.get("/api/workspaces/:workspaceId/people", async (request) => {
    requireCan(request.userRole, "person.read");
    const { workspaceId } = workspaceIdParamsSchema.parse(request.params);
    const accessible = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: request.user!.id,
        },
      },
      select: { id: true },
    });
    const collaborator = accessible
      ? null
      : await prisma.eventCollaborator.findFirst({
          where: {
            workspaceId,
            acceptedAt: { not: null },
            OR: [{ userId: request.user!.id }, { email: request.user!.email }],
          },
          select: { id: true },
        });

    if (!accessible && !collaborator) {
      const error = new Error("Workspace introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    return prisma.person.findMany({
      where: {
        workspaceId,
        archivedAt: null,
      },
      orderBy: { fullName: "asc" },
    });
  });

  fastify.get("/api/people/tags", async (request) => {
    requireCan(request.userRole, "person.read");

    const persons = await prisma.person.findMany({
      where: { workspaceId: request.workspaceId, archivedAt: null },
      select: { tags: true },
    });

    const tagSet = new Set<string>();
    for (const person of persons) {
      for (const tag of person.tags) tagSet.add(tag);
    }

    return [...tagSet].sort();
  });

  fastify.post("/api/people", async (request, reply) => {
    requireCan(request.userRole, "person.write");
    const parsed = personSchema.parse(request.body);

    const person = await prisma.person.create({
      data: {
        fullName: parsed.fullName,
        workspaceId: request.workspaceId,
        email: parsed.email || null,
        phone: parsed.phone || null,
        discordUserId: parsed.discordUserId || null,
        tags: parsed.tags,
        notes: parsed.notes || null,
      },
    });

    return reply.status(201).send(person);
  });

  fastify.get("/api/people/:id", async (request) => {
    requireCan(request.userRole, "person.read");
    const { id } = idParamsSchema.parse(request.params);

    const person = await prisma.person.findFirst({ where: { id, workspaceId: request.workspaceId } });
    if (!person) {
      const error = new Error("Personne introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    return person;
  });

  fastify.put("/api/people/:id", async (request) => {
    requireCan(request.userRole, "person.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = personSchema.parse(request.body);

    return prisma.person.update({
      where: { id, workspaceId: request.workspaceId },
      data: {
        fullName: parsed.fullName,
        email: parsed.email || null,
        phone: parsed.phone || null,
        discordUserId: parsed.discordUserId || null,
        tags: parsed.tags,
        notes: parsed.notes || null,
      },
    });
  });

  fastify.post("/api/people/:id/archive", async (request) => {
    requireCan(request.userRole, "person.write");
    const { id } = idParamsSchema.parse(request.params);

    return prisma.person.update({
      where: { id, workspaceId: request.workspaceId },
      data: { archivedAt: new Date() },
    });
  });

  fastify.post("/api/people/:id/restore", async (request) => {
    requireCan(request.userRole, "person.write");
    const { id } = idParamsSchema.parse(request.params);

    return prisma.person.update({
      where: { id, workspaceId: request.workspaceId },
      data: { archivedAt: null },
    });
  });
}
