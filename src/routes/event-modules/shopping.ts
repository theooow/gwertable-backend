import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { shoppingSchema, boughtSchema, boughtWithExpenseSchema } from "../../schemas/shopping.js";
import { ShoppingDao } from "../../dao/shopping.dao.js";
import { ShoppingRepository } from "../../repositories/shopping.repository.js";
import { ShoppingService } from "../../services/shopping.service.js";
import { toShoppingItemDTO } from "../../dto/shopping.dto.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const eventItemParamsSchema = z.object({ eventId: z.string().min(1), id: z.string().min(1) });
const idParamsSchema = z.object({ id: z.string().min(1) });

const service = new ShoppingService(
  new ShoppingRepository(new ShoppingDao(prisma), prisma),
);

export async function shoppingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events/:eventId/shopping", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const items = await service.list(eventId, request.workspaceId, request.userRole);
    return items.map(toShoppingItemDTO);
  });

  fastify.post("/api/events/:eventId/shopping", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = shoppingSchema.parse(request.body);
    const item = await service.create(eventId, request.workspaceId, request.userRole, data);
    return reply.status(201).send(item);
  });

  fastify.put("/api/events/:eventId/shopping/:id", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    const data = shoppingSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, data);
  });

  fastify.put("/api/shopping/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = shoppingSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, data);
  });

  fastify.patch("/api/events/:eventId/shopping/:id/bought", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    const data = boughtSchema.parse(request.body);
    return service.updateBought(id, request.workspaceId, request.userRole, data);
  });

  fastify.patch("/api/shopping/:id/bought", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = boughtSchema.parse(request.body);
    return service.updateBought(id, request.workspaceId, request.userRole, data);
  });

  fastify.post("/api/events/:eventId/shopping/:id/bought-with-expense", async (request) => {
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    const data = boughtWithExpenseSchema.parse(request.body);
    return service.buyWithExpense(id, request.workspaceId, request.userRole, data, eventId);
  });

  fastify.post("/api/shopping/:id/bought-with-expense", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = boughtWithExpenseSchema.parse(request.body);
    return service.buyWithExpense(id, request.workspaceId, request.userRole, data);
  });

  fastify.delete("/api/events/:eventId/shopping/:id", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole);
  });

  fastify.delete("/api/shopping/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole);
  });

  fastify.get("/api/events/:eventId/shopping/persons", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listPersons(eventId, request.workspaceId, request.userRole);
  });
}
