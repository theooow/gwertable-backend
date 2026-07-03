import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { requireCan } from "../../lib/permissions.js";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import { env } from "../../env.js";
import { participantSchema } from "../../schemas/participant.js";
import { EventParticipantDao } from "../../dao/event-participant.dao.js";
import { EventParticipantRepository } from "../../repositories/event-participant.repository.js";
import { EventParticipantService } from "../../services/event-participant.service.js";
import { toParticipantDTO } from "../../dto/participant.dto.js";
import { ActivityRepository } from "../../repositories/activity.repository.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const eventItemParamsSchema = z.object({ eventId: z.string().min(1), id: z.string().min(1) });
const idParamsSchema = z.object({ id: z.string().min(1) });
const eventCollaboratorParamsSchema = z.object({
  eventId: z.string().min(1),
  collaboratorId: z.string().min(1),
});
const eventCollaboratorSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  role: z.enum(["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"]),
});

const service = new EventParticipantService(
  new EventParticipantRepository(new EventParticipantDao(prisma), prisma),
);
const activityRepository = new ActivityRepository(prisma);

export async function participantRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events/:eventId/participants", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const participants = await service.list(eventId, request.workspaceId, request.userRole);
    const canSee = service.canSeeSensitive(request.userRole);
    return participants.map((p) => toParticipantDTO(p, canSee));
  });

  fastify.post("/api/events/:eventId/participants", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = participantSchema.parse(request.body);
    const participant = await service.create(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    const canSee = service.canSeeSensitive(request.userRole);
    return reply.status(201).send(toParticipantDTO(participant, canSee));
  });

  fastify.put("/api/events/:eventId/participants/:id", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    const data = participantSchema.parse(request.body);
    const participant = await service.update(id, request.workspaceId, request.userRole, request.user!.id, data);
    const canSee = service.canSeeSensitive(request.userRole);
    return toParticipantDTO(participant, canSee);
  });

  fastify.put("/api/participants/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = participantSchema.parse(request.body);
    const participant = await service.update(id, request.workspaceId, request.userRole, request.user!.id, data);
    const canSee = service.canSeeSensitive(request.userRole);
    return toParticipantDTO(participant, canSee);
  });

  fastify.delete("/api/events/:eventId/participants/:id", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole, request.user!.id);
  });

  fastify.delete("/api/participants/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole, request.user!.id);
  });

  fastify.get("/api/events/:eventId/participants/persons", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listPersons(eventId, request.workspaceId, request.userRole);
  });

  fastify.get("/api/events/:eventId/collaborators", async (request) => {
    requireCan(request.userRole, "event.read");
    const { eventId } = eventParamsSchema.parse(request.params);

    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: request.workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");

    const collaborators = await prisma.eventCollaborator.findMany({
      where: { eventId, workspaceId: request.workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, email: true, role: true, token: true,
        expires: true, acceptedAt: true, createdAt: true, userId: true,
      },
    });

    return collaborators.map((c) => {
      const inviteUrl = new URL("/login", env.FRONTEND_URL);
      inviteUrl.searchParams.set("invite", c.token);
      return { ...c, inviteUrl: inviteUrl.toString() };
    });
  });

  fastify.post("/api/events/:eventId/collaborators", async (request, reply) => {
    requireCan(request.userRole, "event.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = eventCollaboratorSchema.parse(request.body);

    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: request.workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");

    const existing = await prisma.eventCollaborator.findUnique({
      where: { eventId_email: { eventId, email: parsed.email } },
    });
    if (existing?.acceptedAt) throw new ConflictError("Ce compte a deja acces a cet evenement");

    const token = crypto.randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const collaborator = await prisma.eventCollaborator.upsert({
      where: { eventId_email: { eventId, email: parsed.email } },
      create: { eventId, workspaceId: request.workspaceId, email: parsed.email, role: parsed.role, token, expires },
      update: { role: parsed.role, token, expires, acceptedAt: null, userId: null },
    });

    const inviteUrl = new URL("/login", env.FRONTEND_URL);
    inviteUrl.searchParams.set("invite", collaborator.token);

    await activityRepository.record({
      workspaceId: request.workspaceId,
      eventId,
      actorId: request.user!.id,
      type: "COLLABORATOR_INVITED",
      title: `Collaborateur invité : ${collaborator.email}`,
      body: `Rôle : ${collaborator.role}`,
      entityType: "COLLABORATOR",
      entityId: collaborator.id,
      notify: false,
    });

    return reply.status(201).send({
      id: collaborator.id,
      email: collaborator.email,
      role: collaborator.role,
      expires: collaborator.expires,
      createdAt: collaborator.createdAt,
      acceptedAt: collaborator.acceptedAt,
      inviteUrl: inviteUrl.toString(),
    });
  });

  fastify.delete("/api/events/:eventId/collaborators/:collaboratorId", async (request) => {
    requireCan(request.userRole, "event.write");
    const { eventId, collaboratorId } = eventCollaboratorParamsSchema.parse(request.params);

    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: request.workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");

    const collaborator = await prisma.eventCollaborator.findFirst({
      where: { id: collaboratorId, eventId, workspaceId: request.workspaceId },
      select: { id: true, email: true },
    });
    if (!collaborator) throw new NotFoundError("Collaborateur introuvable");

    await prisma.eventCollaborator.delete({ where: { id: collaborator.id } });
    await activityRepository.record({
      workspaceId: request.workspaceId,
      eventId,
      actorId: request.user!.id,
      type: "COLLABORATOR_REMOVED",
      title: `Collaborateur retiré : ${collaborator.email}`,
      entityType: "COLLABORATOR",
      entityId: collaborator.id,
      notify: false,
    });
    return { ok: true };
  });
}
