import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TicketSource, type Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireCan, can } from "../lib/permissions.js";
import { parseEuros } from "../lib/money.js";
import { participantSchema } from "../schemas/participant.js";
import { taskSchema, taskStatusSchema } from "../schemas/task.js";
import { expenseSchema } from "../schemas/expense.js";
import { ticketTierSchema } from "../schemas/ticket-tier.js";
import { incomeSchema } from "../schemas/income.js";
import { runOfShowSchema } from "../schemas/run-of-show.js";
import {
  boughtSchema,
  boughtWithExpenseSchema,
  shoppingSchema,
} from "../schemas/shopping.js";
import {
  fetchShotgunEvents,
  fetchShotgunTickets,
  getShotgunWorkspaceConfig,
  groupShotgunSoldTickets,
  type ShotgunEvent,
} from "../lib/shotgun.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const tokenParamsSchema = z.object({ token: z.string().min(24) });
const eventItemParamsSchema = z.object({
  eventId: z.string().min(1),
  id: z.string().min(1),
});
const eventCollaboratorParamsSchema = z.object({
  eventId: z.string().min(1),
  collaboratorId: z.string().min(1),
});
const idParamsSchema = z.object({ id: z.string().min(1) });
const eventCollaboratorSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  role: z.enum(["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"]),
});
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
const allowedBannerTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
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

async function requireParticipantPersonInEvent(personId: string, eventId: string, workspaceId: string) {
  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId,
      personId,
      event: { workspaceId },
      person: { workspaceId },
    },
    select: { id: true },
  });
  if (!participant) {
    const error = new Error("Participant introuvable pour cet evenement");
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

async function requireIncomeInWorkspace(id: string, workspaceId: string) {
  const income = await prisma.income.findFirst({
    where: { id, event: { workspaceId } },
    select: { id: true },
  });
  if (!income) {
    const error = new Error("Revenu introuvable");
    error.name = "NotFoundError";
    throw error;
  }
}

async function requireTicketTierInWorkspace(id: string, workspaceId: string) {
  const tier = await prisma.ticketTier.findFirst({
    where: { id, event: { workspaceId } },
    select: { id: true },
  });
  if (!tier) {
    const error = new Error("Tarif billet introuvable");
    error.name = "NotFoundError";
    throw error;
  }
}

function shotgunRevenueCentsForDeal(deal: ShotgunEvent["deals"][number]) {
  return Math.max(0, Math.round(deal.price * 100));
}

function shotgunPublicPriceCentsForDeal(deal: ShotgunEvent["deals"][number]) {
  const organizerFees = deal.organizer_fees ?? 0;
  const userFees = deal.user_fees ?? 0;
  return Math.max(0, Math.round((deal.price + organizerFees + userFees) * 100));
}

async function syncShotgunTicketTiers(eventId: string, workspaceId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, workspaceId },
    select: { id: true, shotgunEventId: true },
  });
  if (!event?.shotgunEventId) {
    const error = new Error("Cet evenement n'est pas lie a Shotgun");
    error.name = "ValidationError";
    throw error;
  }

  const config = await getShotgunWorkspaceConfig(workspaceId);
  const shotgunEvents = [
    ...await fetchShotgunEvents(config, {}),
    ...await fetchShotgunEvents(config, { pastEvents: true }),
  ].filter((shotgunEvent, index, array) => array.findIndex((candidate) => candidate.id === shotgunEvent.id) === index);
  const shotgunEvent = shotgunEvents.find((candidate) => candidate.id === event.shotgunEventId);
  if (!shotgunEvent) {
    const error = new Error("Evenement Shotgun introuvable");
    error.name = "NotFoundError";
    throw error;
  }

  const soldCounts = groupShotgunSoldTickets(await fetchShotgunTickets(config, shotgunEvent.id));
  const remoteDealIds = new Set(shotgunEvent.deals.map((deal) => deal.product_id));

  await prisma.$transaction(async (tx) => {
    for (const deal of shotgunEvent.deals) {
      const sold = soldCounts.get(deal.product_id) ?? 0;
      await tx.ticketTier.upsert({
        where: { shotgunDealId: deal.product_id },
        create: {
          eventId,
          name: deal.name,
          shotgunDealId: deal.product_id,
          organizerRevenueCents: shotgunRevenueCentsForDeal(deal),
          publicPriceCents: shotgunPublicPriceCentsForDeal(deal),
          quantity: deal.quantity,
          sold,
          source: TicketSource.API_SHOTGUN,
        },
        update: {
          eventId,
          name: deal.name,
          organizerRevenueCents: shotgunRevenueCentsForDeal(deal),
          publicPriceCents: shotgunPublicPriceCentsForDeal(deal),
          quantity: deal.quantity,
          sold,
          source: TicketSource.API_SHOTGUN,
        },
      });
    }

    await tx.ticketTier.deleteMany({
      where: {
        eventId,
        source: TicketSource.API_SHOTGUN,
        shotgunDealId: { notIn: [...remoteDealIds] },
      },
    });
  });
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

function normalizeParticipantFeeValue(fee: string | null | undefined, roles: string[]) {
  if (!roles.includes("ARTIST")) return null;
  if (fee === null || fee === undefined || fee.trim() === "") return null;
  return parseFloat(fee);
}

async function syncArtistExpenseForParticipant(
  tx: Prisma.TransactionClient,
  participant: {
    id: string;
    eventId: string;
    personId: string;
    roles: string[];
    fee: { toString(): string } | null;
  },
) {
  const feeValue = participant.fee?.toString() ?? null;
  const amountCents = normalizeParticipantFeeValue(feeValue, participant.roles);

  if (amountCents === null) {
    const existingExpense = await tx.expense.findUnique({
      where: { sourceParticipantId: participant.id },
      select: { id: true },
    });
    if (existingExpense) {
      await tx.expense.delete({ where: { id: existingExpense.id } });
    }
    return;
  }

  const person = await tx.person.findUnique({
    where: { id: participant.personId },
    select: { fullName: true },
  });
  const label = `Cachet ${person?.fullName ?? "participant"}`;
  await tx.expense.upsert({
    where: { sourceParticipantId: participant.id },
    create: {
      eventId: participant.eventId,
      sourceParticipantId: participant.id,
      label,
      amountCents: Math.round(amountCents * 100),
      category: "artistes",
      reimbursement: "PENDING",
    },
    update: {
      eventId: participant.eventId,
      label,
      amountCents: Math.round(amountCents * 100),
      category: "artistes",
    },
  });
}

async function syncParticipantFeeFromExpense(tx: Prisma.TransactionClient, expense: { sourceParticipantId: string | null; amountCents: number }) {
  if (!expense.sourceParticipantId) return;
  await tx.eventParticipant.update({
    where: { id: expense.sourceParticipantId },
    data: { fee: expense.amountCents / 100 },
  });
}

async function clearParticipantFeeFromExpense(tx: Prisma.TransactionClient, sourceParticipantId: string | null) {
  if (!sourceParticipantId) return;
  await tx.eventParticipant.update({
    where: { id: sourceParticipantId },
    data: { fee: null },
  });
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

function getParisDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function syncRunOfShowItemForTask(
  tx: Prisma.TransactionClient,
  task: {
    id: string;
    eventId: string;
    title: string;
    description: string | null;
    dueAt: Date | null;
    assigneeId: string | null;
  },
) {
  const existingItem = await tx.runOfShowItem.findUnique({
    where: { sourceTaskId: task.id },
    select: { id: true },
  });

  if (!task.dueAt) {
    if (existingItem) {
      await tx.runOfShowItem.delete({ where: { id: existingItem.id } });
    }
    return null;
  }

  if (existingItem) {
    return tx.runOfShowItem.update({
      where: { id: existingItem.id },
      data: {
        startsAt: task.dueAt,
        title: task.title,
        responsiblePersonId: task.assigneeId,
        notes: task.description,
      },
      include: {
        responsiblePerson: { select: { id: true, fullName: true } },
        sourceTask: { select: { id: true, title: true } },
      },
    });
  }

  const event = await tx.event.findFirst({
    where: { id: task.eventId },
    select: { startsAt: true },
  });
  if (!event || getParisDayKey(event.startsAt) !== getParisDayKey(task.dueAt)) return null;

  return tx.runOfShowItem.create({
    data: {
      eventId: task.eventId,
      startsAt: task.dueAt,
      durationMin: 30,
      title: task.title,
      responsiblePersonId: task.assigneeId,
      notes: task.description,
      sourceTaskId: task.id,
    },
    include: {
      responsiblePerson: { select: { id: true, fullName: true } },
      sourceTask: { select: { id: true, title: true } },
    },
  });
}

async function syncTaskForRunOfShowItem(
  tx: Prisma.TransactionClient,
  item: {
    sourceTaskId: string | null;
    title: string;
    startsAt: Date;
    responsiblePersonId: string | null;
    notes: string | null;
  },
) {
  if (!item.sourceTaskId) return null;

  return tx.task.update({
    where: { id: item.sourceTaskId },
    data: {
      title: item.title,
      description: item.notes,
      dueAt: item.startsAt,
      assigneeId: item.responsiblePersonId,
    },
  });
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
    "PRODID:-//Abregi//Tasks//FR",
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
      `UID:abregi-task-${task.id}@abregi`,
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
    .header("content-disposition", `attachment; filename="abregi-taches-${event.id}.ics"`)
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

  fastify.get("/uploads/event-banners/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);
    if (fileName.includes("/") || fileName.includes("\\")) {
      const error = new Error("Banniere introuvable");
      error.name = "NotFoundError";
      throw error;
    }
    const filePath = path.join(uploadRoot, "event-banners", fileName);
    const data = await readFile(filePath).catch(() => null);
    if (!data) {
      const error = new Error("Banniere introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    const extension = path.extname(fileName);
    const contentType =
      extension === ".jpg"
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

  fastify.post("/api/uploads/event-banners", async (request, reply) => {
    requireCan(request.userRole, "event.write");
    const parsed = receiptUploadSchema.parse(request.body);

    if (!allowedBannerTypes.has(parsed.contentType)) {
      const error = new Error("Format de banniere non supporte");
      error.name = "ValidationError";
      throw error;
    }

    const buffer = Buffer.from(parsed.data, "base64");
    if (buffer.byteLength > 5 * 1024 * 1024) {
      const error = new Error("La banniere ne doit pas depasser 5 Mo");
      error.name = "ValidationError";
      throw error;
    }

    const fileName = `${request.workspaceId}-${crypto.randomUUID()}${extensionForContentType(parsed.contentType)}`;
    const directory = path.join(uploadRoot, "event-banners");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), buffer);

    return reply.status(201).send({
      url: `/uploads/event-banners/${fileName}`,
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

    const participant = await prisma.$transaction(async (tx) => {
      const created = await tx.eventParticipant.create({
        data: {
          eventId,
          personId: parsed.personId,
          roles: parsed.roles,
          rsvpStatus: parsed.rsvpStatus,
          plusOnes: parsed.plusOnes,
          dietary: parsed.dietary || null,
          setStart: parsed.setStart ? new Date(parsed.setStart) : null,
          setEnd: parsed.setEnd ? new Date(parsed.setEnd) : null,
          fee: normalizeParticipantFeeValue(parsed.fee, parsed.roles),
          contractSigned: parsed.contractSigned,
          internalNotes: parsed.internalNotes || null,
        },
        include: { person: { select: { id: true, fullName: true } } },
      });

      await syncArtistExpenseForParticipant(tx, created);
      return created;
    });

    return reply.status(201).send(participant);
  });

  fastify.put("/api/events/:eventId/participants/:id", async (request) => {
    requireCan(request.userRole, "participant.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    const parsed = participantSchema.parse(request.body);
    await requireParticipantInWorkspace(id, request.workspaceId);
    await requirePersonInWorkspace(parsed.personId, request.workspaceId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.eventParticipant.update({
        where: { id },
        data: {
          roles: parsed.roles,
          rsvpStatus: parsed.rsvpStatus,
          plusOnes: parsed.plusOnes,
          dietary: parsed.dietary || null,
          setStart: parsed.setStart ? new Date(parsed.setStart) : null,
          setEnd: parsed.setEnd ? new Date(parsed.setEnd) : null,
          fee: normalizeParticipantFeeValue(parsed.fee, parsed.roles),
          contractSigned: parsed.contractSigned,
          internalNotes: parsed.internalNotes || null,
        },
        include: { person: { select: { id: true, fullName: true } } },
      });

      await syncArtistExpenseForParticipant(tx, updated);
      return updated;
    });
  });

  fastify.put("/api/participants/:id", async (request) => {
    requireCan(request.userRole, "participant.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = participantSchema.parse(request.body);
    await requireParticipantInWorkspace(id, request.workspaceId);
    await requirePersonInWorkspace(parsed.personId, request.workspaceId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.eventParticipant.update({
        where: { id },
        data: {
          roles: parsed.roles,
          rsvpStatus: parsed.rsvpStatus,
          plusOnes: parsed.plusOnes,
          dietary: parsed.dietary || null,
          setStart: parsed.setStart ? new Date(parsed.setStart) : null,
          setEnd: parsed.setEnd ? new Date(parsed.setEnd) : null,
          fee: normalizeParticipantFeeValue(parsed.fee, parsed.roles),
          contractSigned: parsed.contractSigned,
          internalNotes: parsed.internalNotes || null,
        },
        include: { person: { select: { id: true, fullName: true } } },
      });

      await syncArtistExpenseForParticipant(tx, updated);
      return updated;
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

  fastify.get("/api/events/:eventId/collaborators", async (request) => {
    requireCan(request.userRole, "event.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const collaborators = await prisma.eventCollaborator.findMany({
      where: { eventId, workspaceId: request.workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        role: true,
        token: true,
        expires: true,
        acceptedAt: true,
        createdAt: true,
        userId: true,
      },
    });

    return collaborators.map((collaborator) => ({
      ...collaborator,
      inviteUrl: (() => {
        const inviteUrl = new URL("/login", frontendUrl);
        inviteUrl.searchParams.set("invite", collaborator.token);
        return inviteUrl.toString();
      })(),
    }));
  });

  fastify.post("/api/events/:eventId/collaborators", async (request, reply) => {
    requireCan(request.userRole, "event.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = eventCollaboratorSchema.parse(request.body);
    await requireEventInWorkspace(eventId, request.workspaceId);

    const existing = await prisma.eventCollaborator.findUnique({
      where: { eventId_email: { eventId, email: parsed.email } },
    });
    if (existing?.acceptedAt) {
      const error = new Error("Ce compte a deja acces a cet evenement");
      error.name = "ConflictError";
      throw error;
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const collaborator = await prisma.eventCollaborator.upsert({
      where: { eventId_email: { eventId, email: parsed.email } },
      create: {
        eventId,
        workspaceId: request.workspaceId,
        email: parsed.email,
        role: parsed.role,
        token,
        expires,
      },
      update: {
        role: parsed.role,
        token,
        expires,
        acceptedAt: null,
        userId: null,
      },
    });

    const inviteUrl = new URL("/login", process.env.FRONTEND_URL ?? "http://localhost:3000");
    inviteUrl.searchParams.set("invite", collaborator.token);

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
    await requireEventInWorkspace(eventId, request.workspaceId);

    const collaborator = await prisma.eventCollaborator.findFirst({
      where: { id: collaboratorId, eventId, workspaceId: request.workspaceId },
      select: { id: true },
    });
    if (!collaborator) {
      const error = new Error("Collaborateur introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    await prisma.eventCollaborator.delete({ where: { id: collaborator.id } });
    return { ok: true };
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

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
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
        include: { assignee: { select: { id: true, fullName: true } } },
      });
      const autoRunOfShowItem = await syncRunOfShowItemForTask(tx, task);
      return { task, autoRunOfShowItem };
    });

    return reply.status(201).send({ ...result.task, autoRunOfShowItem: result.autoRunOfShowItem });
  });

  fastify.put("/api/events/:eventId/tasks/:id", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    const parsed = taskSchema.parse(request.body);
    await requireTaskInWorkspace(id, request.workspaceId);
    if (parsed.assigneeId) await requirePersonInWorkspace(parsed.assigneeId, request.workspaceId);

    return prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
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
      await syncRunOfShowItemForTask(tx, task);
      return task;
    });
  });

  fastify.put("/api/tasks/:id", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = taskSchema.parse(request.body);
    await requireTaskInWorkspace(id, request.workspaceId);
    if (parsed.assigneeId) await requirePersonInWorkspace(parsed.assigneeId, request.workspaceId);

    return prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
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
      await syncRunOfShowItemForTask(tx, task);
      return task;
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
    return prisma.$transaction(async (tx) => {
      const linkedItem = await tx.runOfShowItem.findUnique({
        where: { sourceTaskId: id },
        select: { id: true },
      });
      if (linkedItem) {
        await tx.runOfShowItem.delete({ where: { id: linkedItem.id } });
      }
      return tx.task.delete({ where: { id } });
    });
  });

  fastify.delete("/api/tasks/:id", async (request) => {
    requireCan(request.userRole, "task.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireTaskInWorkspace(id, request.workspaceId);
    return prisma.$transaction(async (tx) => {
      const linkedItem = await tx.runOfShowItem.findUnique({
        where: { sourceTaskId: id },
        select: { id: true },
      });
      if (linkedItem) {
        await tx.runOfShowItem.delete({ where: { id: linkedItem.id } });
      }
      return tx.task.delete({ where: { id } });
    });
  });

  fastify.get("/api/events/:eventId/run-of-show", async (request) => {
    requireCan(request.userRole, "runOfShow.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    return prisma.runOfShowItem.findMany({
      where: { eventId, event: { workspaceId: request.workspaceId } },
      include: {
        responsiblePerson: { select: { id: true, fullName: true } },
        sourceTask: { select: { id: true, title: true } },
      },
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    });
  });

  fastify.post("/api/events/:eventId/run-of-show", async (request, reply) => {
    requireCan(request.userRole, "runOfShow.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = runOfShowSchema.parse(request.body);
    await requireEventInWorkspace(eventId, request.workspaceId);
    if (parsed.responsiblePersonId) {
      await requireParticipantPersonInEvent(parsed.responsiblePersonId, eventId, request.workspaceId);
    }

    const item = await prisma.$transaction(async (tx) => {
      return tx.runOfShowItem.create({
        data: {
          eventId,
          startsAt: new Date(parsed.startsAt),
          durationMin: parsed.durationMin,
          title: parsed.title,
          responsible: parsed.responsible || null,
          responsiblePersonId: parsed.responsiblePersonId || null,
          notes: parsed.notes || null,
        },
        include: {
          responsiblePerson: { select: { id: true, fullName: true } },
          sourceTask: { select: { id: true, title: true } },
        },
      });
    });

    return reply.status(201).send(item);
  });

  fastify.put("/api/events/:eventId/run-of-show/:id", async (request) => {
    requireCan(request.userRole, "runOfShow.write");
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    const parsed = runOfShowSchema.parse(request.body);
    await requireRunOfShowItemInWorkspace(id, request.workspaceId, eventId);
    if (parsed.responsiblePersonId) {
      await requireParticipantPersonInEvent(parsed.responsiblePersonId, eventId, request.workspaceId);
    }

    return prisma.$transaction(async (tx) => {
      const item = await tx.runOfShowItem.update({
        where: { id },
        data: {
          startsAt: new Date(parsed.startsAt),
          durationMin: parsed.durationMin,
          title: parsed.title,
          responsible: parsed.responsible || null,
          responsiblePersonId: parsed.responsiblePersonId || null,
          notes: parsed.notes || null,
        },
        include: {
          responsiblePerson: { select: { id: true, fullName: true } },
          sourceTask: { select: { id: true, title: true } },
        },
      });
      await syncTaskForRunOfShowItem(tx, item);
      return item;
    });
  });

  fastify.put("/api/run-of-show/:id", async (request) => {
    requireCan(request.userRole, "runOfShow.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = runOfShowSchema.parse(request.body);
    const existingItem = await prisma.runOfShowItem.findFirst({
      where: { id, event: { workspaceId: request.workspaceId } },
      select: { eventId: true },
    });
    if (!existingItem) {
      const error = new Error("Element de conducteur introuvable");
      error.name = "NotFoundError";
      throw error;
    }
    if (parsed.responsiblePersonId) {
      await requireParticipantPersonInEvent(parsed.responsiblePersonId, existingItem.eventId, request.workspaceId);
    }

    return prisma.$transaction(async (tx) => {
      const item = await tx.runOfShowItem.update({
        where: { id },
        data: {
          startsAt: new Date(parsed.startsAt),
          durationMin: parsed.durationMin,
          title: parsed.title,
          responsible: parsed.responsible || null,
          responsiblePersonId: parsed.responsiblePersonId || null,
          notes: parsed.notes || null,
        },
        include: {
          responsiblePerson: { select: { id: true, fullName: true } },
          sourceTask: { select: { id: true, title: true } },
        },
      });
      await syncTaskForRunOfShowItem(tx, item);
      return item;
    });
  });

  fastify.delete("/api/events/:eventId/run-of-show/:id", async (request) => {
    requireCan(request.userRole, "runOfShow.write");
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    await requireRunOfShowItemInWorkspace(id, request.workspaceId, eventId);
    return prisma.$transaction(async (tx) => {
      const item = await tx.runOfShowItem.findFirst({
        where: { id, event: { workspaceId: request.workspaceId } },
        select: { id: true, sourceTaskId: true },
      });
      if (!item) {
        const error = new Error("Element de conducteur introuvable");
        error.name = "NotFoundError";
        throw error;
      }
      await tx.runOfShowItem.delete({ where: { id } });
      if (item.sourceTaskId) {
        await tx.task.delete({ where: { id: item.sourceTaskId } });
      }
      return item;
    });
  });

  fastify.delete("/api/run-of-show/:id", async (request) => {
    requireCan(request.userRole, "runOfShow.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireRunOfShowItemInWorkspace(id, request.workspaceId);
    return prisma.$transaction(async (tx) => {
      const item = await tx.runOfShowItem.findFirst({
        where: { id, event: { workspaceId: request.workspaceId } },
        select: { id: true, sourceTaskId: true },
      });
      if (!item) {
        const error = new Error("Element de conducteur introuvable");
        error.name = "NotFoundError";
        throw error;
      }
      await tx.runOfShowItem.delete({ where: { id } });
      if (item.sourceTaskId) {
        await tx.task.delete({ where: { id: item.sourceTaskId } });
      }
      return item;
    });
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

    return prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({
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

      await syncParticipantFeeFromExpense(tx, expense);
      return expense;
    });
  });

  fastify.put("/api/expenses/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = expenseSchema.parse(request.body);
    await requireExpenseInWorkspace(id, request.workspaceId);
    if (parsed.paidById) await requirePersonInWorkspace(parsed.paidById, request.workspaceId);

    return prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({
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

      await syncParticipantFeeFromExpense(tx, expense);
      return expense;
    });
  });

  fastify.delete("/api/events/:eventId/expenses/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = eventItemParamsSchema.parse(request.params);
    await requireExpenseInWorkspace(id, request.workspaceId);
    return prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id, event: { workspaceId: request.workspaceId } },
      });
      await tx.expense.delete({ where: { id } });
      await clearParticipantFeeFromExpense(tx, expense?.sourceParticipantId ?? null);
      return expense;
    });
  });

  fastify.delete("/api/expenses/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireExpenseInWorkspace(id, request.workspaceId);
    return prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id, event: { workspaceId: request.workspaceId } },
      });
      await tx.expense.delete({ where: { id } });
      await clearParticipantFeeFromExpense(tx, expense?.sourceParticipantId ?? null);
      return expense;
    });
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
    return prisma.$transaction(async (tx) => {
      const item = await tx.shoppingItem.delete({ where: { id } });
      if (item.expenseId) {
        await tx.expense.delete({ where: { id: item.expenseId } });
      }
      return item;
    });
  });

  fastify.delete("/api/shopping/:id", async (request) => {
    requireCan(request.userRole, "shopping.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireShoppingItemInWorkspace(id, request.workspaceId);
    return prisma.$transaction(async (tx) => {
      const item = await tx.shoppingItem.delete({ where: { id } });
      if (item.expenseId) {
        await tx.expense.delete({ where: { id: item.expenseId } });
      }
      return item;
    });
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

  // ── Incomes ─────────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/incomes", async (request) => {
    requireCan(request.userRole, "budget.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    return prisma.income.findMany({
      where: { eventId },
      orderBy: { receivedAt: "desc" },
    });
  });

  fastify.post("/api/events/:eventId/incomes", async (request, reply) => {
    requireCan(request.userRole, "budget.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);
    const parsed = incomeSchema.parse(request.body);

    const income = await prisma.income.create({
      data: {
        eventId,
        label: parsed.label,
        amountCents: parsed.amountCents,
        category: parsed.category,
        receivedAt: parsed.receivedAt ? new Date(parsed.receivedAt) : null,
      },
    });
    reply.status(201);
    return income;
  });

  fastify.put("/api/incomes/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireIncomeInWorkspace(id, request.workspaceId);
    const parsed = incomeSchema.parse(request.body);

    return prisma.income.update({
      where: { id },
      data: {
        label: parsed.label,
        amountCents: parsed.amountCents,
        category: parsed.category,
        receivedAt: parsed.receivedAt ? new Date(parsed.receivedAt) : null,
      },
    });
  });

  fastify.delete("/api/incomes/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireIncomeInWorkspace(id, request.workspaceId);

    return prisma.income.delete({ where: { id } });
  });

  // ── Ticket tiers ────────────────────────────────────────────────────────────

  fastify.get("/api/events/:eventId/ticket-tiers", async (request) => {
    requireCan(request.userRole, "budget.read");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);

    try {
      await syncShotgunTicketTiers(eventId, request.workspaceId);
    } catch {
      // Keep the local snapshot available if Shotgun is temporarily unavailable.
    }

    return prisma.ticketTier.findMany({
      where: { eventId },
      orderBy: { organizerRevenueCents: "asc" },
    });
  });

  fastify.post("/api/events/:eventId/ticket-tiers", async (request, reply) => {
    requireCan(request.userRole, "budget.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);
    const parsed = ticketTierSchema.parse(request.body);

    const tier = await prisma.ticketTier.create({
      data: { eventId, ...parsed },
    });
    reply.status(201);
    return tier;
  });

  fastify.put("/api/ticket-tiers/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireTicketTierInWorkspace(id, request.workspaceId);
    const parsed = ticketTierSchema.parse(request.body);

    return prisma.ticketTier.update({ where: { id }, data: parsed });
  });

  fastify.delete("/api/ticket-tiers/:id", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { id } = idParamsSchema.parse(request.params);
    await requireTicketTierInWorkspace(id, request.workspaceId);

    return prisma.ticketTier.delete({ where: { id } });
  });

  fastify.post("/api/events/:eventId/shotgun/sync", async (request) => {
    requireCan(request.userRole, "budget.write");
    const { eventId } = eventParamsSchema.parse(request.params);
    await requireEventInWorkspace(eventId, request.workspaceId);
    await syncShotgunTicketTiers(eventId, request.workspaceId);
    return { ok: true };
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
