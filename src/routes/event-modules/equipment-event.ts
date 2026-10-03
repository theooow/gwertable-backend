import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { ValidationError, NotFoundError } from "../../lib/errors.js";
import { DOCUMENT_BODY_LIMIT, MAX_DOCUMENT_BYTES } from "../../lib/upload-limits.js";
import {
  equipmentBulkImportSchema,
  equipmentImportConfirmSchema,
  equipmentImportPreviewSchema,
  equipmentQuoteSchema,
  equipmentUsageSchema,
  equipmentUsageUpdateSchema,
} from "../../schemas/equipment.js";
import { EquipmentItemDao } from "../../dao/equipment-item.dao.js";
import { ExpenseDao } from "../../dao/expense.dao.js";
import { BudgetRepository } from "../../repositories/budget.repository.js";
import { EquipmentRepository } from "../../repositories/equipment.repository.js";
import { EquipmentService } from "../../services/equipment.service.js";
import { recordRequestActivity } from "../../lib/activity-recorder.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const usageParamsSchema = z.object({ eventId: z.string().min(1), usageId: z.string().min(1) });
const quoteParamsSchema = z.object({ eventId: z.string().min(1), quoteId: z.string().min(1) });
const receiptUploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  data: z.string().min(1),
});

const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
const allowedQuoteFileTypes = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const analyzableQuoteFileTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

function extensionForQuoteFile(contentType: string) {
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  if (contentType === "application/msword") return ".doc";
  const map: Record<string, string> = {
    "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/gif": ".gif",
  };
  return map[contentType] ?? "";
}

function validateQuoteFile(contentType: string, buffer: Buffer, analyzableOnly = false) {
  const allowed = analyzableOnly ? analyzableQuoteFileTypes : allowedQuoteFileTypes;
  if (!allowed.has(contentType)) {
    throw new ValidationError(analyzableOnly
      ? "Format non supporte pour l'analyse automatique (PDF ou image)"
      : "Format non supporte (PDF, image, Word)");
  }
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    throw new ValidationError("Le fichier ne doit pas depasser 20 Mo");
  }
}

async function storeQuoteFile(workspaceId: string, contentType: string, data: string) {
  const buffer = Buffer.from(data, "base64");
  validateQuoteFile(contentType, buffer);
  const ext = extensionForQuoteFile(contentType);
  const fileName = `${workspaceId}-${crypto.randomUUID()}${ext}`;
  const directory = path.join(uploadRoot, "equipment-quotes");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), buffer);
  return `/api/uploads/equipment-quotes/${fileName}`;
}

const budgetRepository = new BudgetRepository(new ExpenseDao(prisma), prisma);
function usageName(usage: { name: string | null; item?: { name: string } | null }) {
  return usage.item?.name ?? usage.name ?? "Matériel";
}

const service = new EquipmentService(
  new EquipmentRepository(new EquipmentItemDao(prisma), budgetRepository, prisma),
);

export async function equipmentEventRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events/:eventId/equipment", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listUsages(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/equipment", { config: { documentation: { params: eventParamsSchema, body: equipmentUsageSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = equipmentUsageSchema.parse(request.body);
    const usage = await service.createUsage(eventId, request.workspaceId, request.userRole, data);
    await recordRequestActivity(request, {
      eventId, type: "EQUIPMENT_ADDED", title: `Matériel ajouté : ${usageName(usage)}`,
      body: `Quantité : ${usage.quantity}`, entityType: "EQUIPMENT", entityId: usage.id,
    });
    return reply.status(201).send(usage);
  });

  fastify.post("/api/events/:eventId/equipment/bulk-import", { config: { documentation: { params: eventParamsSchema, body: equipmentBulkImportSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = equipmentBulkImportSchema.parse(request.body);
    const result = await service.bulkImportLibraryUsages(eventId, request.workspaceId, request.userRole, data);
    await recordRequestActivity(request, {
      eventId, type: "EQUIPMENT_IMPORTED", title: `${result.usages.length} matériel(s) ajouté(s) depuis le catalogue`,
      entityType: "EQUIPMENT",
    });
    return reply.status(201).send(result);
  });

  fastify.put("/api/events/:eventId/equipment/:usageId", { config: { documentation: { params: usageParamsSchema, body: equipmentUsageUpdateSchema } } }, async (request) => {
    const { eventId, usageId } = usageParamsSchema.parse(request.params);
    const data = equipmentUsageUpdateSchema.parse(request.body);
    const usage = await service.updateUsage(usageId, eventId, request.workspaceId, request.userRole, data);
    await recordRequestActivity(request, {
      eventId, type: "EQUIPMENT_UPDATED", title: `Matériel modifié : ${usageName(usage)}`,
      entityType: "EQUIPMENT", entityId: usage.id,
    });
    return usage;
  });

  fastify.delete("/api/events/:eventId/equipment/:usageId", { config: { documentation: { params: usageParamsSchema } } }, async (request) => {
    const { eventId, usageId } = usageParamsSchema.parse(request.params);
    const result = await service.deleteUsage(usageId, eventId, request.workspaceId, request.userRole);
    await recordRequestActivity(request, { eventId, type: "EQUIPMENT_REMOVED", title: "Matériel retiré de l'événement", entityType: "EQUIPMENT" });
    return result;
  });

  fastify.get("/api/events/:eventId/equipment-quotes", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listQuotes(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/equipment-quotes", { config: { documentation: { params: eventParamsSchema, body: equipmentQuoteSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = equipmentQuoteSchema.parse(request.body);
    const quote = await service.createQuote(eventId, request.workspaceId, request.userRole, data);
    await recordRequestActivity(request, {
      eventId, type: "EQUIPMENT_QUOTE_CREATED", title: `Devis matériel créé : ${quote.label}`,
      entityType: "EQUIPMENT_QUOTE", entityId: quote.id,
    });
    return reply.status(201).send(quote);
  });

  fastify.put("/api/events/:eventId/equipment-quotes/:quoteId", { config: { documentation: { params: quoteParamsSchema, body: equipmentQuoteSchema } } }, async (request) => {
    const { eventId, quoteId } = quoteParamsSchema.parse(request.params);
    const data = equipmentQuoteSchema.parse(request.body);
    const quote = await service.updateQuote(quoteId, eventId, request.workspaceId, request.userRole, data);
    await recordRequestActivity(request, {
      eventId, type: "EQUIPMENT_QUOTE_UPDATED", title: `Devis matériel modifié : ${data.label}`,
      entityType: "EQUIPMENT_QUOTE", entityId: quoteId,
    });
    return quote;
  });

  fastify.delete("/api/events/:eventId/equipment-quotes/:quoteId", { config: { documentation: { params: quoteParamsSchema } } }, async (request) => {
    const { eventId, quoteId } = quoteParamsSchema.parse(request.params);
    const result = await service.deleteQuote(quoteId, eventId, request.workspaceId, request.userRole);
    await recordRequestActivity(request, { eventId, type: "EQUIPMENT_QUOTE_DELETED", title: "Devis matériel supprimé", entityType: "EQUIPMENT_QUOTE" });
    return result;
  });

  fastify.post("/api/events/:eventId/equipment-quotes/:quoteId/file", { config: { documentation: { params: quoteParamsSchema, body: receiptUploadSchema, statusCodes: [201] } }, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const { eventId, quoteId } = quoteParamsSchema.parse(request.params);
    const parsed = receiptUploadSchema.parse(request.body);

    if (!allowedQuoteFileTypes.has(parsed.contentType)) {
      throw new ValidationError("Format non supporté (PDF, image, Word)");
    }
    const buffer = Buffer.from(parsed.data, "base64");
    if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
      throw new ValidationError("Le fichier ne doit pas dépasser 20 Mo");
    }

    const ext = extensionForQuoteFile(parsed.contentType);
    const fileName = `${request.workspaceId}-${crypto.randomUUID()}${ext}`;
    const directory = path.join(uploadRoot, "equipment-quotes");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), buffer);

    const fileUrl = `/api/uploads/equipment-quotes/${fileName}`;
    await service.attachQuoteFile(quoteId, eventId, request.workspaceId, request.userRole, fileUrl);
    await recordRequestActivity(request, {
      eventId, type: "EQUIPMENT_QUOTE_FILE_ATTACHED", title: `Document joint au devis : ${parsed.fileName}`,
      entityType: "EQUIPMENT_QUOTE", entityId: quoteId,
    });

    return reply.status(201).send({ url: fileUrl, fileName: parsed.fileName, contentType: parsed.contentType });
  });

  fastify.post("/api/events/:eventId/equipment/import-preview", { config: { documentation: { params: eventParamsSchema, body: equipmentImportPreviewSchema } }, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request) => {
    eventParamsSchema.parse(request.params);
    const parsed = equipmentImportPreviewSchema.parse(request.body);
    const buffer = Buffer.from(parsed.data, "base64");
    validateQuoteFile(parsed.contentType, buffer, true);
    return service.previewDocumentImport(request.workspaceId, request.userRole, request.user!.usagePlan, parsed);
  });

  fastify.post("/api/events/:eventId/equipment/import-confirm", { config: { documentation: { params: eventParamsSchema, body: equipmentImportConfirmSchema, statusCodes: [201] } }, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const parsed = equipmentImportConfirmSchema.parse(request.body);
    const buffer = Buffer.from(parsed.data, "base64");
    validateQuoteFile(parsed.contentType, buffer, true);
    const fileUrl = await storeQuoteFile(request.workspaceId, parsed.contentType, parsed.data);
    const quote = await service.confirmDocumentImport(eventId, request.workspaceId, request.userRole, parsed, fileUrl);
    await recordRequestActivity(request, {
      eventId, type: "EQUIPMENT_IMPORTED", title: `Matériel importé depuis ${parsed.fileName}`,
      entityType: "EQUIPMENT_QUOTE",
    });
    return reply.status(201).send(quote);
  });

  fastify.post("/api/events/:eventId/equipment/group-import", { config: { documentation: { params: eventParamsSchema, body: z.object({
      groupId: z.string().min(1),
      quoteId: z.string().optional().nullable(),
    }), statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const { groupId, quoteId } = z.object({
      groupId: z.string().min(1),
      quoteId: z.string().optional().nullable(),
    }).parse(request.body);

    const group = await prisma.equipmentGroup.findFirst({
      where: { id: groupId, workspaceId: request.workspaceId },
      include: { items: true },
    });
    if (!group) throw new NotFoundError("Groupe introuvable");

    const usages = await Promise.all(
      group.items.map((gi) =>
        service.createUsage(eventId, request.workspaceId, request.userRole, {
          kind: "library",
          itemId: gi.itemId,
          quantity: gi.quantity,
          quoteId: quoteId ?? null,
        }),
      ),
    );

    await recordRequestActivity(request, {
      eventId, type: "EQUIPMENT_IMPORTED", title: `Groupe de matériel ajouté : ${group.name}`,
      body: `${usages.length} matériel(s)`, entityType: "EQUIPMENT",
    });
    return reply.status(201).send(usages);
  });
}
