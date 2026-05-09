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
}
