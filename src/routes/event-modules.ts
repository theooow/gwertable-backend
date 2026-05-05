import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireCan, can } from "../lib/permissions.js";
import { parseEuros } from "../lib/money.js";
import { participantSchema } from "../schemas/participant.js";
import { taskSchema, taskStatusSchema } from "../schemas/task.js";
import { expenseSchema } from "../schemas/expense.js";
import { runOfShowSchema } from "../schemas/run-of-show.js";
import {
  boughtSchema,
  boughtWithExpenseSchema,
  shoppingSchema,
} from "../schemas/shopping.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const tokenParamsSchema = z.object({ token: z.string().min(24) });
const eventItemParamsSchema = z.object({
  eventId: z.string().min(1),
  id: z.string().min(1),
});
const idParamsSchema = z.object({ id: z.string().min(1) });
const receiptUploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  data: z.string().min(1),
});
const allowedReceiptTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

function extensionForContentType(contentType: string) {
  switch (contentType) {
    case "application/pdf":
      return ".pdf";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return "";
  }
}

async function requireEventInWorkspace(eventId: string, workspaceId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, workspaceId },
    select: { id: true },
  });
  if (!event) {
    const error = new Error("Evenement introuvable");
    error.name = "NotFoundError";
    throw error;
  }
}

async function requirePersonInWorkspace(personId: string, workspaceId: string) {
  const person = await prisma.person.findFirst({
    where: { id: personId, workspaceId },
    select: { id: true },
  });
  if (!person) {
    const error = new Error("Personne introuvable");
    error.name = "NotFoundError";
    throw error;
  }
}

async function requireParticipantInWorkspace(id: string, workspaceId: string) {
  const participant = await prisma.eventParticipant.findFirst({
    where: { id, event: { workspaceId } },
    select: { id: true },
  });
  if (!participant) {
    const error = new Error("Participant introuvable");
    error.name = "NotFoundError";
    throw error;
  }
}

async function requireTaskInWorkspace(id: string, workspaceId: string) {
  const task = await prisma.task.findFirst({
    where: { id, event: { workspaceId } },
    select: { id: true },
  });
  if (!task) {
    const error = new Error("Tache introuvable");
    error.name = "NotFoundError";
    throw error;
  }
}

async function requireExpenseInWorkspace(id: string, workspaceId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id, event: { workspaceId } },
    select: { id: true },
  });
  if (!expense) {
    const error = new Error("Depense introuvable");
    error.name = "NotFoundError";
    throw error;
  }
}

async function requireShoppingItemInWorkspace(id: string, workspaceId: string) {
  const item = await prisma.shoppingItem.findFirst({
    where: { id, event: { workspaceId } },
    select: { id: true, eventId: true, name: true },
  });
  if (!item) {
    const error = new Error("Article introuvable");
    error.name = "NotFoundError";
    throw error;
  }
  return item;
}

async function requireRunOfShowItemInWorkspace(id: string, workspaceId: string, eventId?: string) {
  const item = await prisma.runOfShowItem.findFirst({
    where: { id, eventId, event: { workspaceId } },
    select: { id: true },
  });
  if (!item) {
    const error = new Error("Element de conducteur introuvable");
    error.name = "NotFoundError";
    throw error;
  }
}

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

function escapeIcsText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

function formatIcsDate(date: Date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".000", "");
}

function foldIcsLine(line: string) {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 74) {
    chunks.push(remaining.slice(0, 74));
    remaining = ` ${remaining.slice(74)}`;
  }
  chunks.push(remaining);
  return chunks.join("\r\n");
}

function buildTasksCalendar(event: {
  id: string;
  name: string;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    category: string;
    status: string;
    priority: string;
    dueAt: Date | null;
    assignee: { fullName: string } | null;
    updatedAt: Date;
  }>;
}) {
  const now = formatIcsDate(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gwertable//Tasks//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
    `X-WR-CALNAME:${escapeIcsText(`Taches - ${event.name}`)}`,
  ];

  for (const task of event.tasks) {
    if (!task.dueAt) continue;
    const startsAt = task.dueAt;
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const description = [
      task.description,
      `Statut: ${task.status}`,
      `Priorite: ${task.priority}`,
      `Categorie: ${task.category}`,
      task.assignee ? `Assigne a: ${task.assignee.fullName}` : null,
    ].filter(Boolean).join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:gwertable-task-${task.id}@gwertable`,
      `DTSTAMP:${now}`,
      `DTSTART:${formatIcsDate(startsAt)}`,
      `DTEND:${formatIcsDate(endsAt)}`,
      `LAST-MODIFIED:${formatIcsDate(task.updatedAt)}`,
      `SEQUENCE:${Math.floor(task.updatedAt.getTime() / 1000)}`,
      `SUMMARY:${escapeIcsText(task.title)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `CATEGORIES:${escapeIcsText(task.category)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT30M",
      `DESCRIPTION:${escapeIcsText(task.title)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

async function findEventForTasksCalendar(eventId: string, workspaceId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, workspaceId },
    select: {
      id: true,
      name: true,
      tasks: {
        where: { dueAt: { not: null } },
        include: { assignee: { select: { fullName: true } } },
        orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      },
    },
  });

  if (!event) {
    const error = new Error("Evenement introuvable");
    error.name = "NotFoundError";
    throw error;
  }

  return event;
}

function sendTasksCalendar(reply: FastifyReply, event: Awaited<ReturnType<typeof findEventForTasksCalendar>>) {
  return reply
    .type("text/calendar; charset=utf-8")
    .header("content-disposition", `attachment; filename="gwertable-taches-${event.id}.ics"`)
    .header("cache-control", "private, no-store")
    .send(buildTasksCalendar(event));
}

export async function eventModuleRoutes(fastify: FastifyInstance) {
  fastify.get("/calendar/tasks/:token", async (request, reply) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const subscription = await prisma.taskCalendarSubscription.findUnique({
      where: { token },
      select: { eventId: true, event: { select: { workspaceId: true } } },
    });

    if (!subscription) {
      const error = new Error("Abonnement calendrier introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    const event = await findEventForTasksCalendar(subscription.eventId, subscription.event.workspaceId);
    return sendTasksCalendar(reply, event);
  });

  fastify.get("/uploads/receipts/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);
    if (fileName.includes("/") || fileName.includes("\\")) {
      const error = new Error("Justificatif introuvable");
      error.name = "NotFoundError";
      throw error;
    }
    const filePath = path.join(uploadRoot, "receipts", fileName);
    const data = await readFile(filePath).catch(() => null);
    if (!data) {
      const error = new Error("Justificatif introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    const extension = path.extname(fileName);
    const contentType =
      extension === ".pdf"
        ? "application/pdf"
        : extension === ".jpg"
          ? "image/jpeg"
          : extension === ".png"
            ? "image/png"
            : extension === ".webp"
              ? "image/webp"
              : extension === ".gif"
                ? "image/gif"
                : "application/octet-stream";
    return reply.type(contentType).send(data);
  });

  fastify.post("/api/uploads/expense-receipts", async (request, reply) => {
    requireCan(request.userRole, "budget.write");
    const parsed = receiptUploadSchema.parse(request.body);

    if (!allowedReceiptTypes.has(parsed.contentType)) {
      const error = new Error("Format de justificatif non supporte");
      error.name = "ValidationError";
      throw error;
    }

    const buffer = Buffer.from(parsed.data, "base64");
    if (buffer.byteLength > 8 * 1024 * 1024) {
      const error = new Error("Le justificatif ne doit pas depasser 8 Mo");
      error.name = "ValidationError";
      throw error;
    }

    const fileName = `${request.workspaceId}-${crypto.randomUUID()}${extensionForContentType(parsed.contentType)}`;
    const directory = path.join(uploadRoot, "receipts");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), buffer);

    return reply.status(201).send({
      url: `/uploads/receipts/${fileName}`,
      fileName: parsed.fileName,
      contentType: parsed.contentType,
      size: buffer.byteLength,
    });
  });

  fastify.get("/api/events/:eventId/participants", async (request) => {
    requireCan(request.userRole, "participant.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    const canSeeSensitive = can(request.userRole, "budget.read");
    await requireEventInWorkspace(eventId, request.workspaceId);

    const participants = await prisma.eventParticipant.findMany({
      where: { eventId, event: { workspaceId: request.workspaceId } },
      include: { person: { select: { id: true, fullName: true, email: true } } },
      orderBy: { person: { fullName: "asc" } },
    });

    return participants.map((participant) => normalizeParticipant(participant, canSeeSensitive));
  });

  fastify.post("/api/events/:eventId/participants", async (request, reply) => {
    requireCan(request.userRole, "participant.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = participantSchema.parse(request.body);
    await requireEventInWorkspace(eventId, request.workspaceId);
    await requirePersonInWorkspace(parsed.personId, request.workspaceId);

    const existing = await prisma.eventParticipant.findFirst({
      where: { eventId, personId: parsed.personId, event: { workspaceId: request.workspaceId } },
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
    await requireParticipantInWorkspace(id, request.workspaceId);
    await requirePersonInWorkspace(parsed.personId, request.workspaceId);

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
    await requireParticipantInWorkspace(id, request.workspaceId);
    await requirePersonInWorkspace(parsed.personId, request.workspaceId);

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
    await requireParticipantInWorkspace(id, request.workspaceId);
    return prisma.eventParticipant.delete({ where: { id } });
  });

  fastify.delete("/api/participants/:id", async (request) => {
    requireCan(request.userRole, "participant.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireParticipantInWorkspace(id, request.workspaceId);
    return prisma.eventParticipant.delete({ where: { id } });
  });

  fastify.get("/api/events/:eventId/participants/persons", async (request) => {
    requireCan(request.userRole, "participant.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    const participants = await prisma.eventParticipant.findMany({
      where: { eventId, event: { workspaceId: request.workspaceId } },
      select: { personId: true, person: { select: { id: true, fullName: true } } },
      orderBy: { person: { fullName: "asc" } },
    });

    return participants;
  });

  fastify.get("/api/events/:eventId/tasks", async (request) => {
    requireCan(request.userRole, "task.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    return prisma.task.findMany({
      where: { eventId, event: { workspaceId: request.workspaceId } },
      include: { assignee: { select: { id: true, fullName: true } } },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    });
  });

  fastify.get("/api/events/:eventId/tasks/calendar.ics", async (request, reply) => {
    requireCan(request.userRole, "task.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    const event = await findEventForTasksCalendar(eventId, request.workspaceId);
    return sendTasksCalendar(reply, event);
  });

  fastify.get("/api/events/:eventId/tasks/calendar-subscription", async (request) => {
    requireCan(request.userRole, "task.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    const subscription = await prisma.taskCalendarSubscription.upsert({
      where: { eventId },
      create: {
        eventId,
        token: crypto.randomBytes(32).toString("base64url"),
      },
      update: {},
    });

    return { token: subscription.token };
  });

  fastify.post("/api/events/:eventId/tasks", async (request, reply) => {
    requireCan(request.userRole, "task.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = taskSchema.parse(request.body);
    await requireEventInWorkspace(eventId, request.workspaceId);
    if (parsed.assigneeId) await requirePersonInWorkspace(parsed.assigneeId, request.workspaceId);

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
    await requireTaskInWorkspace(id, request.workspaceId);
    if (parsed.assigneeId) await requirePersonInWorkspace(parsed.assigneeId, request.workspaceId);

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
    await requireTaskInWorkspace(id, request.workspaceId);
    if (parsed.assigneeId) await requirePersonInWorkspace(parsed.assigneeId, request.workspaceId);

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
    await requireTaskInWorkspace(id, request.workspaceId);
    return prisma.task.update({ where: { id }, data: { status: parsed.status } });
  });

  fastify.patch("/api/tasks/:id/status", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = taskStatusSchema.parse(request.body);
    await requireTaskInWorkspace(id, request.workspaceId);
    return prisma.task.update({ where: { id }, data: { status: parsed.status } });
  });

  fastify.delete("/api/events/:eventId/tasks/:id", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    await requireTaskInWorkspace(id, request.workspaceId);
    return prisma.task.delete({ where: { id } });
  });

  fastify.delete("/api/tasks/:id", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireTaskInWorkspace(id, request.workspaceId);
    return prisma.task.delete({ where: { id } });
  });

  fastify.get("/api/events/:eventId/run-of-show", async (request) => {
    requireCan(request.userRole, "runOfShow.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    return prisma.runOfShowItem.findMany({
      where: { eventId, event: { workspaceId: request.workspaceId } },
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    });
  });

  fastify.post("/api/events/:eventId/run-of-show", async (request, reply) => {
    requireCan(request.userRole, "runOfShow.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = runOfShowSchema.parse(request.body);
    await requireEventInWorkspace(eventId, request.workspaceId);

    const item = await prisma.runOfShowItem.create({
      data: {
        eventId,
        startsAt: new Date(parsed.startsAt),
        durationMin: parsed.durationMin,
        title: parsed.title,
        responsible: parsed.responsible || null,
        notes: parsed.notes || null,
      },
    });

    return reply.status(201).send(item);
  });

  fastify.put("/api/events/:eventId/run-of-show/:id", async (request) => {
    requireCan(request.userRole, "runOfShow.write");
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    const parsed = runOfShowSchema.parse(request.body);
    await requireRunOfShowItemInWorkspace(id, request.workspaceId, eventId);

    return prisma.runOfShowItem.update({
      where: { id },
      data: {
        startsAt: new Date(parsed.startsAt),
        durationMin: parsed.durationMin,
        title: parsed.title,
        responsible: parsed.responsible || null,
        notes: parsed.notes || null,
      },
    });
  });

  fastify.put("/api/run-of-show/:id", async (request) => {
    requireCan(request.userRole, "runOfShow.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = runOfShowSchema.parse(request.body);
    await requireRunOfShowItemInWorkspace(id, request.workspaceId);

    return prisma.runOfShowItem.update({
      where: { id },
      data: {
        startsAt: new Date(parsed.startsAt),
        durationMin: parsed.durationMin,
        title: parsed.title,
        responsible: parsed.responsible || null,
        notes: parsed.notes || null,
      },
    });
  });

  fastify.delete("/api/events/:eventId/run-of-show/:id", async (request) => {
    requireCan(request.userRole, "runOfShow.write");
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    await requireRunOfShowItemInWorkspace(id, request.workspaceId, eventId);
    return prisma.runOfShowItem.delete({ where: { id } });
  });

  fastify.delete("/api/run-of-show/:id", async (request) => {
    requireCan(request.userRole, "runOfShow.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireRunOfShowItemInWorkspace(id, request.workspaceId);
    return prisma.runOfShowItem.delete({ where: { id } });
  });

  fastify.get("/api/events/:eventId/expenses", async (request) => {
    requireCan(request.userRole, "budget.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    return prisma.expense.findMany({
      where: { eventId, event: { workspaceId: request.workspaceId } },
      include: { paidBy: { select: { id: true, fullName: true } } },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    });
  });

  fastify.post("/api/events/:eventId/expenses", async (request, reply) => {
    requireCan(request.userRole, "budget.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = expenseSchema.parse(request.body);
    await requireEventInWorkspace(eventId, request.workspaceId);
    if (parsed.paidById) await requirePersonInWorkspace(parsed.paidById, request.workspaceId);

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
    await requireExpenseInWorkspace(id, request.workspaceId);
    if (parsed.paidById) await requirePersonInWorkspace(parsed.paidById, request.workspaceId);

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
    await requireExpenseInWorkspace(id, request.workspaceId);
    if (parsed.paidById) await requirePersonInWorkspace(parsed.paidById, request.workspaceId);

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
    await requireExpenseInWorkspace(id, request.workspaceId);
    return prisma.expense.delete({ where: { id } });
  });

  fastify.delete("/api/expenses/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireExpenseInWorkspace(id, request.workspaceId);
    return prisma.expense.delete({ where: { id } });
  });

  fastify.get("/api/events/:eventId/expenses/persons", async (request) => {
    requireCan(request.userRole, "budget.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    const participants = await prisma.eventParticipant.findMany({
      where: { eventId, event: { workspaceId: request.workspaceId } },
      select: { person: { select: { id: true, fullName: true } } },
      orderBy: { person: { fullName: "asc" } },
    });

    return participants.map((participant) => participant.person);
  });

  fastify.get("/api/events/:eventId/shopping", async (request) => {
    requireCan(request.userRole, "shopping.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    const items = await prisma.shoppingItem.findMany({
      where: { eventId, event: { workspaceId: request.workspaceId } },
      include: { buyer: { select: { id: true, fullName: true } } },
      orderBy: [{ bought: "asc" }, { category: "asc" }, { name: "asc" }],
    });

    return items.map(normalizeShoppingItem);
  });

  fastify.post("/api/events/:eventId/shopping", async (request, reply) => {
    requireCan(request.userRole, "shopping.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = shoppingSchema.parse(request.body);
    await requireEventInWorkspace(eventId, request.workspaceId);
    if (parsed.buyerId) await requirePersonInWorkspace(parsed.buyerId, request.workspaceId);

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
    await requireShoppingItemInWorkspace(id, request.workspaceId);
    if (parsed.buyerId) await requirePersonInWorkspace(parsed.buyerId, request.workspaceId);

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
    await requireShoppingItemInWorkspace(id, request.workspaceId);
    if (parsed.buyerId) await requirePersonInWorkspace(parsed.buyerId, request.workspaceId);

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
    await requireShoppingItemInWorkspace(id, request.workspaceId);
    return prisma.shoppingItem.update({ where: { id }, data: { bought: parsed.bought } });
  });

  fastify.patch("/api/shopping/:id/bought", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = boughtSchema.parse(request.body);
    await requireShoppingItemInWorkspace(id, request.workspaceId);
    return prisma.shoppingItem.update({ where: { id }, data: { bought: parsed.bought } });
  });

  fastify.post("/api/events/:eventId/shopping/:id/bought-with-expense", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    const parsed = boughtWithExpenseSchema.parse(request.body);
    await requireEventInWorkspace(eventId, request.workspaceId);
    if (parsed.paidById) await requirePersonInWorkspace(parsed.paidById, request.workspaceId);

    const item = await requireShoppingItemInWorkspace(id, request.workspaceId);
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
    if (parsed.paidById) await requirePersonInWorkspace(parsed.paidById, request.workspaceId);

    const item = await requireShoppingItemInWorkspace(id, request.workspaceId);
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
    await requireShoppingItemInWorkspace(id, request.workspaceId);
    return prisma.shoppingItem.delete({ where: { id } });
  });

  fastify.delete("/api/shopping/:id", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireShoppingItemInWorkspace(id, request.workspaceId);
    return prisma.shoppingItem.delete({ where: { id } });
  });

  fastify.get("/api/events/:eventId/shopping/persons", async (request) => {
    requireCan(request.userRole, "shopping.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    const participants = await prisma.eventParticipant.findMany({
      where: { eventId, event: { workspaceId: request.workspaceId } },
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
        workspaceId: request.workspaceId,
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
