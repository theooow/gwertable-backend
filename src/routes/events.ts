import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { eventSchema } from "../schemas/event.js";
import { LIMITS, requiredText } from "../schemas/limits.js";
import { EventDao } from "../dao/event.dao.js";
import { PersonDao } from "../dao/person.dao.js";
import { EventRepository } from "../repositories/event.repository.js";
import { EventService } from "../services/event.service.js";
import { ActivityRepository } from "../repositories/activity.repository.js";
import { can } from "../lib/permissions.js";
import { billingService } from "./billing.js";

const idParamsSchema = z.object({ id: z.string().min(1) });

let log: FastifyInstance["log"] | undefined;
const service = new EventService(
  new EventRepository(new EventDao(prisma), new PersonDao(prisma), new ActivityRepository(prisma)),
  // A Stripe outage must not fail the event update that is already saved.
  (userId) => billingService.endTrialAfterClosedEvent(userId).catch((error: unknown) => log?.error({ err: error, userId }, "Ending the trial after a closed event failed")),
);

export async function listVisibleEvents(request: FastifyRequest) {
  const collaborator = request.eventScoped
    ? { userId: request.user!.id, userEmail: request.user!.email }
    : undefined;
  const events = await service.list(request.workspaceId, request.userRole, collaborator);
  const invitations = request.eventScoped ? await prisma.eventCollaborator.findMany({
    where: { workspaceId: request.workspaceId, acceptedAt: { not: null }, OR: [{ userId: request.user!.id }, { email: request.user!.email }] },
    select: { eventId: true, role: true },
  }) : [];
  return events.map(({ budgetSummary, ...event }) => ({
    ...event,
    ...(can(invitations.find((entry) => entry.eventId === event.id)?.role ?? request.userRole, "budget.read") ? { budgetSummary } : {}),
  }));
}

export async function eventRoutes(fastify: FastifyInstance) {
  log = fastify.log;
  fastify.get("/api/events", { config: { documentation: {  } } }, async (request) => listVisibleEvents(request));

  fastify.post("/api/events", { config: { documentation: { body: eventSchema, statusCodes: [201] } } }, async (request, reply) => {
    const data = eventSchema.parse(request.body);
    const event = await service.create(request.workspaceId, request.userRole, request.user!.id, request.user!.usagePlan, data);
    return reply.status(201).send(event);
  });

  fastify.get("/api/events/:id", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const collaborator = request.eventScoped
      ? { userId: request.user!.id, userEmail: request.user!.email }
      : undefined;
    const event = await service.get(id, request.workspaceId, request.userRole, collaborator);
    return { ...event, accessRole: request.userRole };
  });

  fastify.put("/api/events/:id", { config: { documentation: { params: idParamsSchema, body: eventSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = eventSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, request.user!.id, request.user!.usagePlan, data);
  });

  fastify.delete("/api/events/:id", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole, request.user!.id);
  });
}
