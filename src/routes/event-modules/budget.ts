import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { expenseSchema } from "../../schemas/expense.js";
import { incomeSchema } from "../../schemas/income.js";
import { ticketTierSchema } from "../../schemas/ticket-tier.js";
import { consumableSchema } from "../../schemas/consumable.js";
import { ExpenseDao } from "../../dao/expense.dao.js";
import { BudgetRepository } from "../../repositories/budget.repository.js";
import { BudgetService } from "../../services/budget.service.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const eventItemParamsSchema = z.object({ eventId: z.string().min(1), id: z.string().min(1) });
const idParamsSchema = z.object({ id: z.string().min(1) });

const service = new BudgetService(
  new BudgetRepository(new ExpenseDao(prisma), prisma),
);

export async function budgetRoutes(fastify: FastifyInstance) {
  // ── Expenses ─────────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/expenses", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listExpenses(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/expenses", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = expenseSchema.parse(request.body);
    const expense = await service.createExpense(eventId, request.workspaceId, request.userRole, data);
    return reply.status(201).send(expense);
  });

  fastify.put("/api/events/:eventId/expenses/:id", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    const data = expenseSchema.parse(request.body);
    return service.updateExpense(id, request.workspaceId, request.userRole, data);
  });

  fastify.put("/api/expenses/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = expenseSchema.parse(request.body);
    return service.updateExpense(id, request.workspaceId, request.userRole, data);
  });

  fastify.delete("/api/events/:eventId/expenses/:id", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    return service.deleteExpense(id, request.workspaceId, request.userRole);
  });

  fastify.delete("/api/expenses/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteExpense(id, request.workspaceId, request.userRole);
  });

  fastify.get("/api/events/:eventId/expenses/persons", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listExpensePersons(eventId, request.workspaceId, request.userRole);
  });

  // ── Incomes ──────────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/incomes", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listIncomes(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/incomes", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = incomeSchema.parse(request.body);
    const income = await service.createIncome(eventId, request.workspaceId, request.userRole, data);
    return reply.status(201).send(income);
  });

  fastify.put("/api/incomes/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = incomeSchema.parse(request.body);
    return service.updateIncome(id, request.workspaceId, request.userRole, data);
  });

  fastify.delete("/api/incomes/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteIncome(id, request.workspaceId, request.userRole);
  });

  // ── Ticket Tiers ─────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/ticket-tiers", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listTicketTiers(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/ticket-tiers", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = ticketTierSchema.parse(request.body);
    const tier = await service.createTicketTier(eventId, request.workspaceId, request.userRole, data);
    return reply.status(201).send(tier);
  });

  fastify.put("/api/ticket-tiers/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = ticketTierSchema.parse(request.body);
    return service.updateTicketTier(id, request.workspaceId, request.userRole, data);
  });

  fastify.delete("/api/ticket-tiers/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteTicketTier(id, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/shotgun/sync", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    await service.syncShotgunTiers(eventId, request.workspaceId, request.userRole);
    return { ok: true };
  });

  // ── Consumables ───────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/consumables", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listConsumables(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/consumables", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = consumableSchema.parse(request.body);
    const item = await service.createConsumable(eventId, request.workspaceId, request.userRole, data);
    return reply.status(201).send(item);
  });

  fastify.put("/api/consumables/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = consumableSchema.parse(request.body);
    return service.updateConsumable(id, request.workspaceId, request.userRole, data);
  });

  fastify.delete("/api/consumables/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteConsumable(id, request.workspaceId, request.userRole);
  });
}
