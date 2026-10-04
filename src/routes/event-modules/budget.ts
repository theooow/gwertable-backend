import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { ValidationError } from "../../lib/errors.js";
import { requireCan } from "../../lib/permissions.js";
import { recordRequestActivity } from "../../lib/activity-recorder.js";
import { DOCUMENT_BODY_LIMIT, MAX_DOCUMENT_BYTES } from "../../lib/upload-limits.js";
import { expenseCellSchema, incomeCellSchema } from "../../schemas/budget-cell.js";
import { budgetImportPreviewSchema, expenseImportConfirmSchema, incomeImportConfirmSchema } from "../../schemas/budget-import.js";
import { expenseSchema } from "../../schemas/expense.js";
import { incomeSchema } from "../../schemas/income.js";
import { ticketTierSchema } from "../../schemas/ticket-tier.js";
import { consumableSchema } from "../../schemas/consumable.js";
import { collectiveSchema, profitSplitSchema } from "../../schemas/collective.js";
import { ExpenseDao } from "../../dao/expense.dao.js";
import { BudgetRepository } from "../../repositories/budget.repository.js";
import { BudgetService } from "../../services/budget.service.js";
import { CollectiveRepository } from "../../repositories/collective.repository.js";
import { CollectiveService } from "../../services/collective.service.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const eventItemParamsSchema = z.object({ eventId: z.string().min(1), id: z.string().min(1) });
const idParamsSchema = z.object({ id: z.string().min(1) });

const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
const receiptExtensions: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

async function storeImportedReceipt(workspaceId: string, contentType: string, data: string) {
  const ext = receiptExtensions[contentType];
  if (!ext) throw new ValidationError("Format non supporte pour l'analyse automatique (PDF ou image)");
  const buffer = Buffer.from(data, "base64");
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) throw new ValidationError("Le fichier ne doit pas depasser 20 Mo");
  const fileName = `${workspaceId}-${crypto.randomUUID()}${ext}`;
  const directory = path.join(uploadRoot, "receipts");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), buffer);
  return `/api/uploads/receipts/${fileName}`;
}

const service = new BudgetService(
  new BudgetRepository(new ExpenseDao(prisma), prisma),
);

const collectiveService = new CollectiveService(new CollectiveRepository(prisma));

export async function budgetRoutes(fastify: FastifyInstance) {
  // ── Expenses ─────────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/expenses", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listExpenses(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/expenses", { config: { documentation: { params: eventParamsSchema, body: expenseSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = expenseSchema.parse(request.body);
    const expense = await service.createExpense(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(expense);
  });

  fastify.put("/api/events/:eventId/expenses/:id", { config: { documentation: { params: eventItemParamsSchema, body: expenseSchema } } }, async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    const data = expenseSchema.parse(request.body);
    return service.updateExpense(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.patch("/api/expenses/:id", { config: { documentation: { params: idParamsSchema, body: expenseCellSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.updateExpenseCell(id, request.workspaceId, request.userRole, request.user!.id, expenseCellSchema.parse(request.body));
  });

  fastify.put("/api/expenses/:id", { config: { documentation: { params: idParamsSchema, body: expenseSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = expenseSchema.parse(request.body);
    return service.updateExpense(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/events/:eventId/expenses/:id", { config: { documentation: { params: eventItemParamsSchema } } }, async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    return service.deleteExpense(id, request.workspaceId, request.userRole, request.user!.id);
  });

  fastify.delete("/api/expenses/:id", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteExpense(id, request.workspaceId, request.userRole, request.user!.id);
  });

  fastify.get("/api/events/:eventId/expenses/persons", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listExpensePersons(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/expenses/import-preview", { config: { documentation: { params: eventParamsSchema, body: budgetImportPreviewSchema } }, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request) => {
    eventParamsSchema.parse(request.params);
    const data = budgetImportPreviewSchema.parse(request.body);
    return service.previewDocumentImport("expense", request.userRole, request.user!.usagePlan, data);
  });

  fastify.post("/api/events/:eventId/expenses/import-confirm", { config: { documentation: { params: eventParamsSchema, body: expenseImportConfirmSchema, statusCodes: [201] } }, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = expenseImportConfirmSchema.parse(request.body);
    requireCan(request.userRole, "budget.write");
    const receiptUrl = await storeImportedReceipt(request.workspaceId, data.contentType, data.data);
    const lines = data.lines.map((line) => ({ ...line, receiptUrl }));
    const expenses = await service.importExpenses(eventId, request.workspaceId, request.userRole, request.user!.id, lines);
    await recordRequestActivity(request, {
      eventId, type: "EXPENSE_IMPORTED", title: `Import de ${expenses.length} ligne(s) de dépense depuis ${data.fileName}`,
      entityType: "EXPENSE", notify: false,
    });
    return reply.status(201).send(expenses);
  });

  // ── Incomes ──────────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/incomes", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listIncomes(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/incomes", { config: { documentation: { params: eventParamsSchema, body: incomeSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = incomeSchema.parse(request.body);
    const income = await service.createIncome(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(income);
  });

  fastify.post("/api/events/:eventId/incomes/import-preview", { config: { documentation: { params: eventParamsSchema, body: budgetImportPreviewSchema } }, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request) => {
    eventParamsSchema.parse(request.params);
    const data = budgetImportPreviewSchema.parse(request.body);
    return service.previewDocumentImport("income", request.userRole, request.user!.usagePlan, data);
  });

  fastify.post("/api/events/:eventId/incomes/import-confirm", { config: { documentation: { params: eventParamsSchema, body: incomeImportConfirmSchema, statusCodes: [201] } }, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = incomeImportConfirmSchema.parse(request.body);
    requireCan(request.userRole, "budget.write");
    const receiptUrl = await storeImportedReceipt(request.workspaceId, data.contentType, data.data);
    const lines = data.lines.map((line) => ({ ...line, receiptUrl }));
    const incomes = await service.importIncomes(eventId, request.workspaceId, request.userRole, request.user!.id, lines);
    await recordRequestActivity(request, {
      eventId, type: "INCOME_IMPORTED", title: `Import de ${incomes.length} ligne(s) de recette depuis ${data.fileName}`,
      entityType: "INCOME", notify: false,
    });
    return reply.status(201).send(incomes);
  });

  fastify.patch("/api/incomes/:id", { config: { documentation: { params: idParamsSchema, body: incomeCellSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.updateIncomeCell(id, request.workspaceId, request.userRole, request.user!.id, incomeCellSchema.parse(request.body));
  });

  fastify.put("/api/incomes/:id", { config: { documentation: { params: idParamsSchema, body: incomeSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = incomeSchema.parse(request.body);
    return service.updateIncome(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/incomes/:id", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteIncome(id, request.workspaceId, request.userRole, request.user!.id);
  });

  // ── Ticket Tiers ─────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/ticket-tiers", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listTicketTiers(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/ticket-tiers", { config: { documentation: { params: eventParamsSchema, body: ticketTierSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = ticketTierSchema.parse(request.body);
    const tier = await service.createTicketTier(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(tier);
  });

  fastify.put("/api/ticket-tiers/:id", { config: { documentation: { params: idParamsSchema, body: ticketTierSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = ticketTierSchema.parse(request.body);
    return service.updateTicketTier(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/ticket-tiers/:id", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteTicketTier(id, request.workspaceId, request.userRole, request.user!.id);
  });

  fastify.post("/api/events/:eventId/shotgun/sync", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    await service.syncShotgunTiers(eventId, request.workspaceId, request.userRole);
    await recordRequestActivity(request, {
      eventId, type: "TICKETING_SYNCED", title: "Billetterie Shotgun synchronisée", entityType: "TICKET_TIER", notify: false,
    });
    return { ok: true };
  });

  // ── Consumables ───────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/consumables", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listConsumables(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/consumables", { config: { documentation: { params: eventParamsSchema, body: consumableSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = consumableSchema.parse(request.body);
    const item = await service.createConsumable(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(item);
  });

  fastify.put("/api/consumables/:id", { config: { documentation: { params: idParamsSchema, body: consumableSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = consumableSchema.parse(request.body);
    return service.updateConsumable(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/consumables/:id", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteConsumable(id, request.workspaceId, request.userRole, request.user!.id);
  });

  // ── Collectives ───────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/collectives", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return collectiveService.list(eventId, request.workspaceId, request.userRole);
  });

  fastify.put("/api/events/:eventId/profit-split", { config: { documentation: { params: eventParamsSchema, body: profitSplitSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = profitSplitSchema.parse(request.body);
    return collectiveService.updateProfitSplit(eventId, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.post("/api/events/:eventId/collectives", { config: { documentation: { params: eventParamsSchema, body: collectiveSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = collectiveSchema.parse(request.body);
    const collective = await collectiveService.create(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(collective);
  });

  fastify.put("/api/collectives/:id", { config: { documentation: { params: idParamsSchema, body: collectiveSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = collectiveSchema.parse(request.body);
    return collectiveService.update(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/collectives/:id", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return collectiveService.delete(id, request.workspaceId, request.userRole, request.user!.id);
  });
}
