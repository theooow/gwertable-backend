import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireCan, can } from "../lib/permissions.js";
import { parseEuros } from "../lib/money.js";
import { participantSchema } from "../schemas/participant.js";
import { taskSchema, taskStatusSchema } from "../schemas/task.js";
import { expenseSchema } from "../schemas/expense.js";
import {
  boughtSchema,
  boughtWithExpenseSchema,
  shoppingSchema,
} from "../schemas/shopping.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const eventItemParamsSchema = z.object({
  eventId: z.string().min(1),
  id: z.string().min(1),
});
const idParamsSchema = z.object({ id: z.string().min(1) });

function normalizeParticipant(participant: Awaited<ReturnType<typeof prisma.eventParticipant.findMany>>[number], canSeeSensitive: boolean) {
  return {
    id: participant.id,
    eventId: participant.eventId,
    personId: participant.personId,
    person: "person" in participant ? participant.person : undefined,
    roles: participant.roles,
    rsvpStatus: participant.rsvpStatus,
    plusOnes: participant.plusOnes,
    dietary: participant.dietary,
    setStart: participant.setStart,
    setEnd: participant.setEnd,
    fee: canSeeSensitive && participant.fee ? participant.fee.toString() : null,
    contractSigned: participant.contractSigned,
    internalNotes: canSeeSensitive ? participant.internalNotes : null,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  };
}

function normalizeShoppingItem(item: Awaited<ReturnType<typeof prisma.shoppingItem.findMany>>[number]) {
  return {
    id: item.id,
    eventId: item.eventId,
    name: item.name,
    quantity: item.quantity.toString(),
    unit: item.unit,
    category: item.category,
    estimatedCents: item.estimatedCents,
    buyerId: item.buyerId,
    buyer: "buyer" in item ? item.buyer : undefined,
    bought: item.bought,
    expenseId: item.expenseId,
  };
}

export async function eventModuleRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events/:eventId/participants", async (request) => {
    requireCan(request.userRole, "participant.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    const canSeeSensitive = can(request.userRole, "budget.read");

    const participants = await prisma.eventParticipant.findMany({
      where: { eventId },
      include: { person: { select: { id: true, fullName: true, email: true } } },
      orderBy: { person: { fullName: "asc" } },
    });

    return participants.map((participant) => normalizeParticipant(participant, canSeeSensitive));
  });

  fastify.post("/api/events/:eventId/participants", async (request, reply) => {
    requireCan(request.userRole, "participant.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = participantSchema.parse(request.body);

    const existing = await prisma.eventParticipant.findUnique({
      where: { eventId_personId: { eventId, personId: parsed.personId } },
    });
    if (existing) {
      const error = new Error("Cette personne est deja participante de cet evenement");
      error.name = "ConflictError";
      throw error;
    }

    const participant = await prisma.eventParticipant.create({
      data: {
        eventId,
        personId: parsed.personId,
        roles: parsed.roles,
        rsvpStatus: parsed.rsvpStatus,
        plusOnes: parsed.plusOnes,
        dietary: parsed.dietary || null,
        setStart: parsed.setStart ? new Date(parsed.setStart) : null,
        setEnd: parsed.setEnd ? new Date(parsed.setEnd) : null,
        fee: parsed.fee ? parseFloat(parsed.fee) : null,
        contractSigned: parsed.contractSigned,
        internalNotes: parsed.internalNotes || null,
      },
    });

    return reply.status(201).send(participant);
  });

  fastify.put("/api/events/:eventId/participants/:id", async (request) => {
    requireCan(request.userRole, "participant.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    const parsed = participantSchema.parse(request.body);

    return prisma.eventParticipant.update({
      where: { id },
      data: {
        roles: parsed.roles,
        rsvpStatus: parsed.rsvpStatus,
        plusOnes: parsed.plusOnes,
        dietary: parsed.dietary || null,
        setStart: parsed.setStart ? new Date(parsed.setStart) : null,
        setEnd: parsed.setEnd ? new Date(parsed.setEnd) : null,
        fee: parsed.fee ? parseFloat(parsed.fee) : null,
        contractSigned: parsed.contractSigned,
        internalNotes: parsed.internalNotes || null,
      },
    });
  });

  fastify.put("/api/participants/:id", async (request) => {
    requireCan(request.userRole, "participant.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = participantSchema.parse(request.body);

    return prisma.eventParticipant.update({
      where: { id },
      data: {
        roles: parsed.roles,
        rsvpStatus: parsed.rsvpStatus,
        plusOnes: parsed.plusOnes,
        dietary: parsed.dietary || null,
        setStart: parsed.setStart ? new Date(parsed.setStart) : null,
        setEnd: parsed.setEnd ? new Date(parsed.setEnd) : null,
        fee: parsed.fee ? parseFloat(parsed.fee) : null,
        contractSigned: parsed.contractSigned,
        internalNotes: parsed.internalNotes || null,
      },
    });
  });

  fastify.delete("/api/events/:eventId/participants/:id", async (request) => {
    requireCan(request.userRole, "participant.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    return prisma.eventParticipant.delete({ where: { id } });
  });

  fastify.delete("/api/participants/:id", async (request) => {
    requireCan(request.userRole, "participant.write");
    const { id } = idParamsSchema.parse(request.params);
    return prisma.eventParticipant.delete({ where: { id } });
  });

  fastify.get("/api/events/:eventId/participants/persons", async (request) => {
    requireCan(request.userRole, "participant.read");
    const { eventId } = eventParamsSchema.parse(request.params);

    const participants = await prisma.eventParticipant.findMany({
      where: { eventId },
      select: { personId: true, person: { select: { id: true, fullName: true } } },
      orderBy: { person: { fullName: "asc" } },
    });

    return participants;
  });

  fastify.get("/api/events/:eventId/tasks", async (request) => {
    requireCan(request.userRole, "task.read");
    const { eventId } = eventParamsSchema.parse(request.params);

    return prisma.task.findMany({
      where: { eventId },
      include: { assignee: { select: { id: true, fullName: true } } },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    });
  });

  fastify.post("/api/events/:eventId/tasks", async (request, reply) => {
    requireCan(request.userRole, "task.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = taskSchema.parse(request.body);

    const task = await prisma.task.create({
      data: {
        eventId,
        title: parsed.title,
        description: parsed.description || null,
        category: parsed.category,
        status: parsed.status,
        priority: parsed.priority,
        dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
        assigneeId: parsed.assigneeId || null,
      },
    });

    return reply.status(201).send(task);
  });

  fastify.put("/api/events/:eventId/tasks/:id", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    const parsed = taskSchema.parse(request.body);

    return prisma.task.update({
      where: { id },
      data: {
        title: parsed.title,
        description: parsed.description || null,
        category: parsed.category,
        status: parsed.status,
        priority: parsed.priority,
        dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
        assigneeId: parsed.assigneeId || null,
      },
    });
  });

  fastify.put("/api/tasks/:id", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = taskSchema.parse(request.body);

    return prisma.task.update({
      where: { id },
      data: {
        title: parsed.title,
        description: parsed.description || null,
        category: parsed.category,
        status: parsed.status,
        priority: parsed.priority,
        dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
        assigneeId: parsed.assigneeId || null,
      },
    });
  });

  fastify.patch("/api/events/:eventId/tasks/:id/status", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    const parsed = taskStatusSchema.parse(request.body);
    return prisma.task.update({ where: { id }, data: { status: parsed.status } });
  });

  fastify.patch("/api/tasks/:id/status", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = taskStatusSchema.parse(request.body);
    return prisma.task.update({ where: { id }, data: { status: parsed.status } });
  });

  fastify.delete("/api/events/:eventId/tasks/:id", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    return prisma.task.delete({ where: { id } });
  });

  fastify.delete("/api/tasks/:id", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = idParamsSchema.parse(request.params);
    return prisma.task.delete({ where: { id } });
  });

  fastify.get("/api/events/:eventId/expenses", async (request) => {
    requireCan(request.userRole, "budget.read");
    const { eventId } = eventParamsSchema.parse(request.params);

    return prisma.expense.findMany({
      where: { eventId },
      include: { paidBy: { select: { id: true, fullName: true } } },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    });
  });

  fastify.post("/api/events/:eventId/expenses", async (request, reply) => {
    requireCan(request.userRole, "budget.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = expenseSchema.parse(request.body);

    const expense = await prisma.expense.create({
      data: {
        eventId,
        label: parsed.label,
        amountCents: parseEuros(parsed.amount),
        category: parsed.category,
        paidById: parsed.paidById || null,
        paidAt: parsed.paidAt ? new Date(parsed.paidAt) : null,
        reimbursement: parsed.reimbursement,
        receiptUrl: parsed.receiptUrl || null,
        notes: parsed.notes || null,
      },
    });

    return reply.status(201).send(expense);
  });

  fastify.put("/api/events/:eventId/expenses/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    const parsed = expenseSchema.parse(request.body);

    return prisma.expense.update({
      where: { id },
      data: {
        label: parsed.label,
        amountCents: parseEuros(parsed.amount),
        category: parsed.category,
        paidById: parsed.paidById || null,
        paidAt: parsed.paidAt ? new Date(parsed.paidAt) : null,
        reimbursement: parsed.reimbursement,
        receiptUrl: parsed.receiptUrl || null,
        notes: parsed.notes || null,
      },
    });
  });

  fastify.put("/api/expenses/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = expenseSchema.parse(request.body);

    return prisma.expense.update({
      where: { id },
      data: {
        label: parsed.label,
        amountCents: parseEuros(parsed.amount),
        category: parsed.category,
        paidById: parsed.paidById || null,
        paidAt: parsed.paidAt ? new Date(parsed.paidAt) : null,
        reimbursement: parsed.reimbursement,
        receiptUrl: parsed.receiptUrl || null,
        notes: parsed.notes || null,
      },
    });
  });

  fastify.delete("/api/events/:eventId/expenses/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    return prisma.expense.delete({ where: { id } });
  });

  fastify.delete("/api/expenses/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = idParamsSchema.parse(request.params);
    return prisma.expense.delete({ where: { id } });
  });

  fastify.get("/api/events/:eventId/expenses/persons", async (request) => {
    requireCan(request.userRole, "budget.read");
    const { eventId } = eventParamsSchema.parse(request.params);

    const participants = await prisma.eventParticipant.findMany({
      where: { eventId },
      select: { person: { select: { id: true, fullName: true } } },
      orderBy: { person: { fullName: "asc" } },
    });

    return participants.map((participant) => participant.person);
  });

  fastify.get("/api/events/:eventId/shopping", async (request) => {
    requireCan(request.userRole, "shopping.read");
    const { eventId } = eventParamsSchema.parse(request.params);

    const items = await prisma.shoppingItem.findMany({
      where: { eventId },
      include: { buyer: { select: { id: true, fullName: true } } },
      orderBy: [{ bought: "asc" }, { category: "asc" }, { name: "asc" }],
    });

    return items.map(normalizeShoppingItem);
  });

  fastify.post("/api/events/:eventId/shopping", async (request, reply) => {
    requireCan(request.userRole, "shopping.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = shoppingSchema.parse(request.body);

    const item = await prisma.shoppingItem.create({
      data: {
        eventId,
        name: parsed.name,
        quantity: parseFloat(parsed.quantity) || 1,
        unit: parsed.unit || null,
        category: parsed.category,
        estimatedCents: parsed.estimatedCents ? parseEuros(parsed.estimatedCents) : null,
        buyerId: parsed.buyerId || null,
      },
    });

    return reply.status(201).send(item);
  });

  fastify.put("/api/events/:eventId/shopping/:id", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    const parsed = shoppingSchema.parse(request.body);

    return prisma.shoppingItem.update({
      where: { id },
      data: {
        name: parsed.name,
        quantity: parseFloat(parsed.quantity) || 1,
        unit: parsed.unit || null,
        category: parsed.category,
        estimatedCents: parsed.estimatedCents ? parseEuros(parsed.estimatedCents) : null,
        buyerId: parsed.buyerId || null,
      },
    });
  });

  fastify.put("/api/shopping/:id", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = shoppingSchema.parse(request.body);

    return prisma.shoppingItem.update({
      where: { id },
      data: {
        name: parsed.name,
        quantity: parseFloat(parsed.quantity) || 1,
        unit: parsed.unit || null,
        category: parsed.category,
        estimatedCents: parsed.estimatedCents ? parseEuros(parsed.estimatedCents) : null,
        buyerId: parsed.buyerId || null,
      },
    });
  });

  fastify.patch("/api/events/:eventId/shopping/:id/bought", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    const parsed = boughtSchema.parse(request.body);
    return prisma.shoppingItem.update({ where: { id }, data: { bought: parsed.bought } });
  });

  fastify.patch("/api/shopping/:id/bought", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = boughtSchema.parse(request.body);
    return prisma.shoppingItem.update({ where: { id }, data: { bought: parsed.bought } });
  });

  fastify.post("/api/events/:eventId/shopping/:id/bought-with-expense", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    const parsed = boughtWithExpenseSchema.parse(request.body);

    const item = await prisma.shoppingItem.findUniqueOrThrow({ where: { id } });
    const expense = await prisma.expense.create({
      data: {
        eventId,
        label: item.name,
        amountCents: parsed.amountCents,
        category: "courses",
        paidById: parsed.paidById,
        paidAt: new Date(),
        reimbursement: parsed.paidById ? "PENDING" : "NOT_OWED",
      },
    });

    await prisma.shoppingItem.update({
      where: { id },
      data: { bought: true, expenseId: expense.id },
    });

    return expense;
  });

  fastify.post("/api/shopping/:id/bought-with-expense", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = boughtWithExpenseSchema.parse(request.body);

    const item = await prisma.shoppingItem.findUniqueOrThrow({ where: { id } });
    const expense = await prisma.expense.create({
      data: {
        eventId: item.eventId,
        label: item.name,
        amountCents: parsed.amountCents,
        category: "courses",
        paidById: parsed.paidById,
        paidAt: new Date(),
        reimbursement: parsed.paidById ? "PENDING" : "NOT_OWED",
      },
    });

    await prisma.shoppingItem.update({
      where: { id },
      data: { bought: true, expenseId: expense.id },
    });

    return expense;
  });

  fastify.delete("/api/events/:eventId/shopping/:id", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    return prisma.shoppingItem.delete({ where: { id } });
  });

  fastify.delete("/api/shopping/:id", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = idParamsSchema.parse(request.params);
    return prisma.shoppingItem.delete({ where: { id } });
  });

  fastify.get("/api/events/:eventId/shopping/persons", async (request) => {
    requireCan(request.userRole, "shopping.read");
    const { eventId } = eventParamsSchema.parse(request.params);

    const participants = await prisma.eventParticipant.findMany({
      where: { eventId },
      select: { person: { select: { id: true, fullName: true } } },
      orderBy: { person: { fullName: "asc" } },
    });

    return participants.map((participant) => participant.person);
  });

  fastify.get("/api/people/search", async (request) => {
    requireCan(request.userRole, "person.read");
    const query = z.object({ q: z.string().optional().default("") }).parse(request.query).q;

    return prisma.person.findMany({
      where: {
        archivedAt: null,
        OR: [
          { fullName: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, fullName: true, email: true },
      take: 10,
      orderBy: { fullName: "asc" },
    });
  });
}
