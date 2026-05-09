import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { personSchema } from "../schemas/person.js";
import { PersonDao } from "../dao/person.dao.js";
import { PersonRepository } from "../repositories/person.repository.js";
import { PersonService } from "../services/person.service.js";
import { toPersonDTO, toPersonDetailDTO } from "../dto/person.dto.js";
import { requireCan } from "../lib/permissions.js";
import { NotFoundError } from "../lib/errors.js";

const idParamsSchema = z.object({ id: z.string().min(1) });
const workspaceIdParamsSchema = z.object({ workspaceId: z.string().min(1) });
const documentIdParamsSchema = z.object({ documentId: z.string().min(1) });
const noteIdParamsSchema = z.object({ noteId: z.string().min(1) });

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
  contactType: z.string().optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
});

const documentBodySchema = z.object({
  label: z.string().min(1).max(200),
  url: z.string().min(1).max(500),
  isUpload: z.boolean().default(false),
  category: z.string().min(1).max(100),
});

const historyNoteBodySchema = z.object({
  body: z.string().min(1).max(2000),
  eventDate: z.string().datetime().optional().nullable(),
});

const dao = new PersonDao(prisma);
const service = new PersonService(
  new PersonRepository(dao, prisma),
);

export async function peopleRoutes(fastify: FastifyInstance) {
  fastify.get("/api/people", async (request) => {
    const { search, tags, contactType, includeArchived } = peopleQuerySchema.parse(request.query);
    const people = await service.list(request.workspaceId, request.userRole, {
      search: search || undefined,
      tags: tags.length > 0 ? tags : undefined,
      contactType: contactType || undefined,
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

  fastify.get("/api/people/search", async (request) => {
    const { q } = z.object({ q: z.string().optional().default("") }).parse(request.query);
    return service.list(request.workspaceId, request.userRole, {
      search: q || undefined,
      includeArchived: false,
    }).then((people) =>
      people.slice(0, 10).map((p) => ({ id: p.id, fullName: p.fullName, email: p.email })),
    );
  });

  fastify.get("/api/people/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    requireCan(request.userRole, "person.read");
    const person = await dao.findWithDetails(id, request.workspaceId);
    return toPersonDetailDTO(person);
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

  fastify.post("/api/people/:id/documents", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    requireCan(request.userRole, "person.write");
    await dao.findByIdOrThrow(id, request.workspaceId);
    const data = documentBodySchema.parse(request.body);
    const doc = await dao.createDocument(id, data);
    return reply.status(201).send(doc);
  });

  fastify.delete("/api/people/documents/:documentId", async (request, reply) => {
    const { documentId } = documentIdParamsSchema.parse(request.params);
    requireCan(request.userRole, "person.write");
    const existing = await prisma.personDocument.findFirst({
      where: { id: documentId, person: { workspaceId: request.workspaceId } },
    });
    if (!existing) throw new NotFoundError("Document introuvable");
    await dao.deleteDocument(documentId, existing.personId);
    return reply.status(204).send();
  });

  fastify.post("/api/people/:id/history", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    requireCan(request.userRole, "person.write");
    await dao.findByIdOrThrow(id, request.workspaceId);
    const { body, eventDate } = historyNoteBodySchema.parse(request.body);
    const note = await dao.createHistoryNote(id, {
      body,
      eventDate: eventDate ? new Date(eventDate) : null,
    });
    return reply.status(201).send(note);
  });

  fastify.delete("/api/people/history/:noteId", async (request, reply) => {
    const { noteId } = noteIdParamsSchema.parse(request.params);
    requireCan(request.userRole, "person.write");
    const existing = await prisma.personHistoryNote.findFirst({
      where: { id: noteId, person: { workspaceId: request.workspaceId } },
    });
    if (!existing) throw new NotFoundError("Note introuvable");
    await dao.deleteHistoryNote(noteId, existing.personId);
    return reply.status(204).send();
  });
}
