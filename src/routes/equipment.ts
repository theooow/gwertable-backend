import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireCan } from "../lib/permissions.js";
import { equipmentItemSchema } from "../schemas/equipment.js";

const idParamsSchema = z.object({ id: z.string().min(1) });

export async function equipmentRoutes(fastify: FastifyInstance) {
  fastify.get("/api/equipment", async (request) => {
    requireCan(request.userRole, "equipment.read");

    return prisma.equipmentItem.findMany({
      where: { workspaceId: request.workspaceId, archivedAt: null },
      include: { owner: { select: { id: true, fullName: true } } },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  });

  fastify.post("/api/equipment", async (request, reply) => {
    requireCan(request.userRole, "equipment.write");
    const parsed = equipmentItemSchema.parse(request.body);

    const item = await prisma.equipmentItem.create({
      data: {
        workspaceId: request.workspaceId,
        name: parsed.name,
        category: parsed.category,
        ownership: parsed.ownership,
        ownerId: parsed.ownerId ?? null,
        unitPriceCents: parsed.unitPriceCents,
        rentalCoef: parsed.rentalCoef,
        quantity: parsed.quantity,
        notes: parsed.notes || null,
      },
      include: { owner: { select: { id: true, fullName: true } } },
    });

    return reply.status(201).send(item);
  });

  fastify.put("/api/equipment/:id", async (request) => {
    requireCan(request.userRole, "equipment.write");
    const { id } = idParamsSchema.parse(request.params);
    const parsed = equipmentItemSchema.parse(request.body);

    const existing = await prisma.equipmentItem.findUnique({
      where: { id, workspaceId: request.workspaceId },
      select: { id: true },
    });
    if (!existing) {
      const error = new Error("Équipement introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    return prisma.equipmentItem.update({
      where: { id },
      data: {
        name: parsed.name,
        category: parsed.category,
        ownership: parsed.ownership,
        ownerId: parsed.ownerId ?? null,
        unitPriceCents: parsed.unitPriceCents,
        rentalCoef: parsed.rentalCoef,
        quantity: parsed.quantity,
        notes: parsed.notes || null,
      },
      include: { owner: { select: { id: true, fullName: true } } },
    });
  });

  fastify.delete("/api/equipment/:id", async (request) => {
    requireCan(request.userRole, "equipment.write");
    const { id } = idParamsSchema.parse(request.params);

    const existing = await prisma.equipmentItem.findUnique({
      where: { id, workspaceId: request.workspaceId },
      select: { id: true },
    });
    if (!existing) {
      const error = new Error("Équipement introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    return prisma.equipmentItem.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  });
}
