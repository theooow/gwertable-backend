import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { eventSchema } from "../schemas/event.js";
import { LIMITS, requiredText } from "../schemas/limits.js";
import { EventDao } from "../dao/event.dao.js";
import { VenueDao } from "../dao/venue.dao.js";
import { EventRepository } from "../repositories/event.repository.js";
import { EventService } from "../services/event.service.js";
import { ActivityRepository } from "../repositories/activity.repository.js";

const idParamsSchema = z.object({ id: z.string().min(1) });
const createVenueSchema = z.object({ name: requiredText("Le nom du lieu", LIMITS.name) });

const service = new EventService(
  new EventRepository(new EventDao(prisma), new VenueDao(prisma), new ActivityRepository(prisma)),
);

export async function eventRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events", async (request) => {
    const collaborator = request.eventScoped
      ? { userId: request.user!.id, userEmail: request.user!.email }
      : undefined;
    return service.list(request.workspaceId, request.userRole, collaborator);
  });

  fastify.post("/api/events", async (request, reply) => {
    const data = eventSchema.parse(request.body);
    const event = await service.create(request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(event);
  });

  fastify.get("/api/events/venues", async (request) => {
    return service.listVenues(request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/venues", async (request, reply) => {
    const { name } = createVenueSchema.parse(request.body);
    const venue = await service.createVenue(request.workspaceId, request.userRole, name);
    return reply.status(201).send(venue);
  });

  fastify.get("/api/events/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const collaborator = request.eventScoped
      ? { userId: request.user!.id, userEmail: request.user!.email }
      : undefined;
    return service.get(id, request.workspaceId, request.userRole, collaborator);
  });

  fastify.put("/api/events/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = eventSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/events/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole, request.user!.id);
  });
}
