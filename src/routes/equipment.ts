import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { equipmentItemSchema } from "../schemas/equipment.js";
import { EquipmentItemDao } from "../dao/equipment-item.dao.js";
import { ExpenseDao } from "../dao/expense.dao.js";
import { BudgetRepository } from "../repositories/budget.repository.js";
import { EquipmentRepository } from "../repositories/equipment.repository.js";
import { EquipmentService } from "../services/equipment.service.js";
import { toEquipmentItemDTO } from "../dto/equipment.dto.js";

const idParamsSchema = z.object({ id: z.string().min(1) });

const service = new EquipmentService(
  new EquipmentRepository(
    new EquipmentItemDao(prisma),
    new BudgetRepository(new ExpenseDao(prisma), prisma),
    prisma,
  ),
);

export async function equipmentRoutes(fastify: FastifyInstance) {
  fastify.get("/api/equipment", async (request) => {
    const items = await service.list(request.workspaceId, request.userRole);
    return items.map(toEquipmentItemDTO);
  });

  fastify.post("/api/equipment", async (request, reply) => {
    const data = equipmentItemSchema.parse(request.body);
    const item = await service.create(request.workspaceId, request.userRole, data);
    return reply.status(201).send(toEquipmentItemDTO(item));
  });

  fastify.put("/api/equipment/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = equipmentItemSchema.parse(request.body);
    const item = await service.update(id, request.workspaceId, request.userRole, data);
    return toEquipmentItemDTO(item);
  });

  fastify.delete("/api/equipment/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.archive(id, request.workspaceId, request.userRole);
  });

  fastify.get("/api/workspaces/:workspaceId/equipment", async (request) => {
    const { workspaceId: sourceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const membership = await prisma.workspaceMember.findFirst({
      where: { workspaceId: sourceId, userId: request.user!.id },
      select: { role: true },
    });
    if (!membership) throw new Error("Accès refusé");
    const items = await service.list(sourceId, membership.role);
    return items.map(toEquipmentItemDTO);
  });

  fastify.post("/api/equipment/import", async (request, reply) => {
    const { sourceWorkspaceId, itemIds } = z.object({
      sourceWorkspaceId: z.string().min(1),
      itemIds: z.array(z.string().min(1)).min(1).max(200),
    }).parse(request.body);
    const sourceMembership = await prisma.workspaceMember.findFirst({
      where: { workspaceId: sourceWorkspaceId, userId: request.user!.id },
      select: { role: true },
    });
    if (!sourceMembership) throw new Error("Accès refusé à ce workspace");
    const items = await service.importFromWorkspace(
      request.workspaceId, sourceWorkspaceId, itemIds, request.userRole,
    );
    return reply.status(201).send(items.map(toEquipmentItemDTO));
  });
}
