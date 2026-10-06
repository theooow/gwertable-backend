import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { EventDao } from "../dao/event.dao.js";
import { ExpenseDao } from "../dao/expense.dao.js";
import { VenueDao } from "../dao/venue.dao.js";
import { ActivityRepository } from "../repositories/activity.repository.js";
import { BudgetLeadRepository } from "../repositories/budget-lead.repository.js";
import { BudgetRepository } from "../repositories/budget.repository.js";
import { EventRepository } from "../repositories/event.repository.js";
import { budgetLeadSchema, budgetTrialSchema, budgetTrialTokenSchema } from "../schemas/budget-trial.js";
import { BudgetService } from "../services/budget.service.js";
import { BudgetTrialService } from "../services/budget-trial.service.js";
import { EventService } from "../services/event.service.js";

const service = new BudgetTrialService(
  new BudgetLeadRepository(prisma),
  new EventService(new EventRepository(new EventDao(prisma), new VenueDao(prisma), new ActivityRepository(prisma))),
  new BudgetService(new BudgetRepository(new ExpenseDao(prisma), prisma)),
);

export async function budgetTrialRoutes(fastify: FastifyInstance) {
  fastify.post("/api/public/budget-trial", { config: { documentation: { body: budgetLeadSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { email, anonymousId } = budgetLeadSchema.parse(request.body);
    return reply.status(201).send(await service.startTrial(email, anonymousId));
  });

  fastify.get("/api/public/budget-trial/:token", { config: { documentation: { params: budgetTrialTokenSchema } } }, async (request) => {
    const { token } = budgetTrialTokenSchema.parse(request.params);
    return service.getTrial(token);
  });

  fastify.put("/api/public/budget-trial/:token", { config: { documentation: { params: budgetTrialTokenSchema, body: budgetTrialSchema, statusCodes: [204] } } }, async (request, reply) => {
    const { token } = budgetTrialTokenSchema.parse(request.params);
    await service.saveTrial(token, budgetTrialSchema.parse(request.body));
    return reply.status(204).send();
  });

  fastify.post("/api/public/budget-trial/:token/unsubscribe", { config: { documentation: { params: budgetTrialTokenSchema, statusCodes: [204] } } }, async (request, reply) => {
    const { token } = budgetTrialTokenSchema.parse(request.params);
    await service.unsubscribe(token);
    return reply.status(204).send();
  });

  fastify.post("/api/budget-trial/:token/claim", { config: { documentation: { params: budgetTrialTokenSchema } } }, async (request) => {
    const { token } = budgetTrialTokenSchema.parse(request.params);
    return service.claim(token, request.workspaceId, request.userRole, request.user!.id);
  });
}
