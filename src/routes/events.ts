import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TicketSource } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireCan } from "../lib/permissions.js";
import { eventSchema } from "../schemas/event.js";
import { LIMITS, requiredText } from "../schemas/limits.js";

const idParamsSchema = z.object({ id: z.string().min(1) });
const createVenueSchema = z.object({ name: requiredText("Le nom du lieu", LIMITS.name) });

export async function eventRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events", async (request) => {
    requireCan(request.userRole, "event.read");

    if (request.eventScoped) {
      const collaboratorEvents = await prisma.eventCollaborator.findMany({
        where: {
          acceptedAt: { not: null },
          workspaceId: request.workspaceId,
          OR: [{ userId: request.user!.id }, { email: request.user!.email }],
        },
        select: { eventId: true },
      });

      return prisma.event.findMany({
        where: {
          workspaceId: request.workspaceId,
          id: { in: collaboratorEvents.map((entry) => entry.eventId) },
        },
        include: {
          venue: { select: { name: true } },
          _count: { select: { participants: true, tasks: true, expenses: true, runOfShow: true } },
        },
        orderBy: { startsAt: "desc" },
      });
    }

    return prisma.event.findMany({
      where: { workspaceId: request.workspaceId },
      include: {
        venue: { select: { name: true } },
        _count: { select: { participants: true, tasks: true, expenses: true, runOfShow: true } },
      },
      orderBy: { startsAt: "desc" },
    });
  });

  fastify.post("/api/events", async (request, reply) => {
    requireCan(request.userRole, "event.write");
    const parsed = eventSchema.parse(request.body);
    if (parsed.venueId) {
      const venue = await prisma.venue.findFirst({
        where: { id: parsed.venueId, workspaceId: request.workspaceId },
        select: { id: true },
      });
      if (!venue) {
        const error = new Error("Lieu introuvable");
        error.name = "NotFoundError";
        throw error;
      }
    }

    const event = await prisma.event.create({
      data: {
        name: parsed.name,
        shotgunEventId: parsed.shotgunEventId ?? null,
        startsAt: new Date(parsed.startsAt),
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
        status: parsed.status,
        description: parsed.description || null,
        bannerUrl: parsed.bannerUrl || null,
        workspaceId: request.workspaceId,
        venueId: parsed.venueId || null,
      },
    });

    return reply.status(201).send(event);
  });

  fastify.get("/api/events/venues", async (request) => {
    requireCan(request.userRole, "event.read");

    return prisma.venue.findMany({
      where: { workspaceId: request.workspaceId, archivedAt: null },
      orderBy: { name: "asc" },
    });
  });

  fastify.post("/api/events/venues", async (request, reply) => {
    requireCan(request.userRole, "event.write");
    const parsed = createVenueSchema.parse(request.body);

    const venue = await prisma.venue.create({
      data: { name: parsed.name, workspaceId: request.workspaceId },
    });

    return reply.status(201).send(venue);
  });

  fastify.get("/api/events/:id", async (request) => {
    requireCan(request.userRole, "event.read");
    const { id } = idParamsSchema.parse(request.params);

    if (request.eventScoped) {
      const collaborator = await prisma.eventCollaborator.findFirst({
        where: {
          eventId: id,
          workspaceId: request.workspaceId,
          acceptedAt: { not: null },
          OR: [{ userId: request.user!.id }, { email: request.user!.email }],
        },
        select: { id: true },
      });
      if (!collaborator) {
        const error = new Error("Evenement introuvable");
        error.name = "NotFoundError";
        throw error;
      }
    }

    const event = await prisma.event.findUnique({
      where: { id, workspaceId: request.workspaceId },
      include: {
        venue: true,
        _count: {
          select: {
            participants: true,
            tasks: true,
            expenses: true,
            shopping: true,
            shifts: true,
            runOfShow: true,
          },
        },
      },
    });

    if (!event) {
      const error = new Error("Evenement introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    return event;
  });

  fastify.put("/api/events/:id", async (request) => {
    requireCan(request.userRole, "event.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = eventSchema.parse(request.body);
    const current = await prisma.event.findUnique({
      where: { id, workspaceId: request.workspaceId },
      select: { shotgunEventId: true },
    });
    if (parsed.venueId) {
      const venue = await prisma.venue.findFirst({
        where: { id: parsed.venueId, workspaceId: request.workspaceId },
        select: { id: true },
      });
      if (!venue) {
        const error = new Error("Lieu introuvable");
        error.name = "NotFoundError";
        throw error;
      }
    }

    const updated = await prisma.event.update({
      where: { id, workspaceId: request.workspaceId },
      data: {
        name: parsed.name,
        shotgunEventId: parsed.shotgunEventId ?? null,
        startsAt: new Date(parsed.startsAt),
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
        status: parsed.status,
        description: parsed.description || null,
        bannerUrl: parsed.bannerUrl || null,
        venueId: parsed.venueId || null,
        nbCollectifs: parsed.nbCollectifs,
      },
    });

    const currentShotgunEventId = current?.shotgunEventId;
    if (currentShotgunEventId && currentShotgunEventId !== parsed.shotgunEventId) {
      await prisma.ticketTier.deleteMany({
        where: { eventId: id, source: TicketSource.API_SHOTGUN },
      });
    }

    return updated;
  });

  fastify.delete("/api/events/:id", async (request) => {
    requireCan(request.userRole, "event.write");
    const { id } = idParamsSchema.parse(request.params);

    const event = await prisma.event.findUnique({
      where: { id, workspaceId: request.workspaceId },
      select: { id: true },
    });
    if (!event) {
      const error = new Error("Evenement introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    return prisma.event.delete({ where: { id } });
  });
}
