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
  fastify.get("/api/events/:eventId/shopping", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const items = await service.list(eventId, request.workspaceId, request.userRole);
    return items.map(toShoppingItemDTO);
  });

  fastify.post("/api/events/:eventId/shopping", { config: { documentation: { params: eventParamsSchema, body: shoppingSchema, statusCodes: [201] } } }, async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = shoppingSchema.parse(request.body);
    const item = await service.create(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(item);
  });

  fastify.put("/api/events/:eventId/shopping/:id", { config: { documentation: { params: eventItemParamsSchema, body: shoppingSchema } } }, async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    const data = shoppingSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.put("/api/shopping/:id", { config: { documentation: { params: idParamsSchema, body: shoppingSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = shoppingSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.patch("/api/events/:eventId/shopping/:id/bought", { config: { documentation: { params: eventItemParamsSchema, body: boughtSchema } } }, async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    const data = boughtSchema.parse(request.body);
    return service.updateBought(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.patch("/api/shopping/:id/bought", { config: { documentation: { params: idParamsSchema, body: boughtSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = boughtSchema.parse(request.body);
    return service.updateBought(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.post("/api/events/:eventId/shopping/:id/bought-with-expense", { config: { documentation: { params: eventItemParamsSchema, body: boughtWithExpenseSchema } } }, async (request) => {
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    const data = boughtWithExpenseSchema.parse(request.body);
    return service.buyWithExpense(id, request.workspaceId, request.userRole, request.user!.id, data, eventId);
  });

  fastify.post("/api/shopping/:id/bought-with-expense", { config: { documentation: { params: idParamsSchema, body: boughtWithExpenseSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = boughtWithExpenseSchema.parse(request.body);
    return service.buyWithExpense(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/events/:eventId/shopping/:id", { config: { documentation: { params: eventItemParamsSchema } } }, async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole, request.user!.id);
  });

  fastify.delete("/api/shopping/:id", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole, request.user!.id);
  });

  fastify.get("/api/events/:eventId/shopping/persons", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listPersons(eventId, request.workspaceId, request.userRole);
  });
}
