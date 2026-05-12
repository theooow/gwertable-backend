import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCan } from "../../lib/permissions.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";

const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
const allowedReceiptTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
const allowedBannerTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const allowedPersonDocTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const receiptUploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  data: z.string().min(1),
});

function extensionForContentType(contentType: string) {
  switch (contentType) {
    case "application/pdf": return ".pdf";
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "image/gif": return ".gif";
    case "application/msword": return ".doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return ".docx";
    default: return "";
  }
}

function contentTypeForExtension(ext: string): string {
  const map: Record<string, string> = {
    ".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Routes de gestion des fichiers uploadés (I/O pure, pas de logique métier).
 * Couvre les justificatifs de dépenses, bannières d'événements et devis équipement.
 */
export async function uploadRoutes(fastify: FastifyInstance) {
  fastify.get("/uploads/receipts/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);
    if (fileName.includes("/") || fileName.includes("\\")) throw new NotFoundError("Justificatif introuvable");
    const data = await readFile(path.join(uploadRoot, "receipts", fileName)).catch(() => null);
    if (!data) throw new NotFoundError("Justificatif introuvable");
    return reply.type(contentTypeForExtension(path.extname(fileName))).send(data);
  });

  fastify.get("/uploads/event-banners/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);
    if (fileName.includes("/") || fileName.includes("\\")) throw new NotFoundError("Banniere introuvable");
    const data = await readFile(path.join(uploadRoot, "event-banners", fileName)).catch(() => null);
    if (!data) throw new NotFoundError("Banniere introuvable");
    return reply.type(contentTypeForExtension(path.extname(fileName))).send(data);
  });

  fastify.get("/uploads/equipment-photos/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);
    if (fileName.includes("/") || fileName.includes("\\")) return reply.status(400).send({ error: "Invalid file name" });
    const data = await readFile(path.join(uploadRoot, "equipment-photos", fileName)).catch(() => null);
    if (!data) return reply.status(404).send({ error: "File not found" });
    const contentType = contentTypeForExtension(path.extname(fileName).toLowerCase());
    reply.header("content-type", contentType);
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return reply.send(data);
  });

  fastify.get("/uploads/equipment-quotes/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);
    if (fileName.includes("/") || fileName.includes("\\")) return reply.status(400).send({ error: "Invalid file name" });
    const data = await readFile(path.join(uploadRoot, "equipment-quotes", fileName)).catch(() => null);
    if (!data) return reply.status(404).send({ error: "File not found" });
    const contentType = contentTypeForExtension(path.extname(fileName).toLowerCase());
    reply.header("content-type", contentType);
    reply.header("cache-control", "private, max-age=3600");
    return reply.send(data);
  });

  fastify.post("/api/uploads/expense-receipts", async (request, reply) => {
    requireCan(request.userRole, "budget.write");
    const parsed = receiptUploadSchema.parse(request.body);
    if (!allowedReceiptTypes.has(parsed.contentType)) throw new ValidationError("Format de justificatif non supporte");
    const buffer = Buffer.from(parsed.data, "base64");
    if (buffer.byteLength > 8 * 1024 * 1024) throw new ValidationError("Le justificatif ne doit pas depasser 8 Mo");

    const fileName = `${request.workspaceId}-${crypto.randomUUID()}${extensionForContentType(parsed.contentType)}`;
    const directory = path.join(uploadRoot, "receipts");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), buffer);

    return reply.status(201).send({ url: `/uploads/receipts/${fileName}`, fileName: parsed.fileName, contentType: parsed.contentType, size: buffer.byteLength });
  });

  fastify.post("/api/uploads/event-banners", async (request, reply) => {
    requireCan(request.userRole, "event.write");
    const parsed = receiptUploadSchema.parse(request.body);
    if (!allowedBannerTypes.has(parsed.contentType)) throw new ValidationError("Format de banniere non supporte");
    const buffer = Buffer.from(parsed.data, "base64");
    if (buffer.byteLength > 5 * 1024 * 1024) throw new ValidationError("La banniere ne doit pas depasser 5 Mo");

    const fileName = `${request.workspaceId}-${crypto.randomUUID()}${extensionForContentType(parsed.contentType)}`;
    const directory = path.join(uploadRoot, "event-banners");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), buffer);

    return reply.status(201).send({ url: `/uploads/event-banners/${fileName}`, fileName: parsed.fileName, contentType: parsed.contentType, size: buffer.byteLength });
  });

  fastify.get("/uploads/person-documents/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);
    if (fileName.includes("/") || fileName.includes("\\")) return reply.status(400).send({ error: "Invalid file name" });
    const data = await readFile(path.join(uploadRoot, "person-documents", fileName)).catch(() => null);
    if (!data) return reply.status(404).send({ error: "File not found" });
    const contentType = contentTypeForExtension(path.extname(fileName).toLowerCase());
    reply.header("content-type", contentType);
    reply.header("cache-control", "private, max-age=3600");
    return reply.send(data);
  });

  fastify.post("/api/uploads/person-documents", async (request, reply) => {
    requireCan(request.userRole, "person.write");
    const parsed = receiptUploadSchema.parse(request.body);
    if (!allowedPersonDocTypes.has(parsed.contentType)) throw new ValidationError("Format de document non supporte");
    const buffer = Buffer.from(parsed.data, "base64");
    if (buffer.byteLength > 8 * 1024 * 1024) throw new ValidationError("Le document ne doit pas depasser 8 Mo");

    const fileName = `${request.workspaceId}-${crypto.randomUUID()}${extensionForContentType(parsed.contentType)}`;
    const directory = path.join(uploadRoot, "person-documents");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), buffer);

    return reply.status(201).send({ url: `/uploads/person-documents/${fileName}`, fileName: parsed.fileName, contentType: parsed.contentType, size: buffer.byteLength });
  });
}
