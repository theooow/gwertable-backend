import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireCan } from "../lib/permissions.js";
import { eventSchema } from "../schemas/event.js";

const idParamsSchema = z.object({ id: z.string().min(1) });
const createVenueSchema = z.object({ name: z.string().trim().min(1, "Le nom du lieu est requis") });

export async function eventRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events", async (request) => {
    requireCan(request.userRole, "event.read");

    return prisma.event.findMany({
      include: {
        venue: { select: { name: true } },
        _count: { select: { participants: true, tasks: true, expenses: true } },
      },
      orderBy: { startsAt: "desc" },
    });
  });

  fastify.post("/api/events", async (request, reply) => {
    requireCan(request.userRole, "event.write");
    const parsed = eventSchema.parse(request.body);

    const event = await prisma.event.create({
      data: {
        name: parsed.name,
        startsAt: new Date(parsed.startsAt),
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
        status: parsed.status,
        description: parsed.description || null,
        venueId: parsed.venueId || null,
      },
    });

    return reply.status(201).send(event);
  });

  fastify.get("/api/events/venues", async (request) => {
    requireCan(request.userRole, "event.read");

    return prisma.venue.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
    });
  });

  fastify.post("/api/events/venues", async (request, reply) => {
    requireCan(request.userRole, "event.write");
    const parsed = createVenueSchema.parse(request.body);

    const venue = await prisma.venue.create({
      data: { name: parsed.name },
    });

    return reply.status(201).send(venue);
  });

  fastify.get("/api/events/:id", async (request) => {
    requireCan(request.userRole, "event.read");
    const { id } = idParamsSchema.parse(request.params);

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        venue: true,
        _count: {
          select: {
            participants: true,
            tasks: true,
            expenses: true,
            shopping: true,
            shifts: true,
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

    return prisma.event.update({
      where: { id },
      data: {
        name: parsed.name,
        startsAt: new Date(parsed.startsAt),
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
        status: parsed.status,
        description: parsed.description || null,
        venueId: parsed.venueId || null,
      },
    });
  });
}
