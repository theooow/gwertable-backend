import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { buildTasksCalendar } from "../../lib/calendar.js";
import { taskAttachmentSchema, taskCommentSchema, taskCategorySchema, taskSchema, taskStatusSchema } from "../../schemas/task.js";
import { TaskDao } from "../../dao/task.dao.js";
import { TaskCalendarSubscriptionDao } from "../../dao/task-calendar-subscription.dao.js";
import { TaskRepository } from "../../repositories/task.repository.js";
import { TaskService } from "../../services/task.service.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const eventItemParamsSchema = z.object({ eventId: z.string().min(1), id: z.string().min(1) });
const idParamsSchema = z.object({ id: z.string().min(1) });
const attachmentParamsSchema = z.object({ id: z.string().min(1), attachmentId: z.string().min(1) });
const tokenParamsSchema = z.object({ token: z.string().min(24) });

const service = new TaskService(
  new TaskRepository(
    new TaskDao(prisma),
    new TaskCalendarSubscriptionDao(prisma),
    prisma,
  ),
);

export async function taskRoutes(fastify: FastifyInstance) {
  fastify.get("/calendar/tasks/:token", async (request, reply) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const event = await service.findEventForCalendarByToken(token);
    return reply
      .type("text/calendar; charset=utf-8")
      .header("content-disposition", `attachment; filename="abregi-taches-${event.id}.ics"`)
      .header("cache-control", "private, no-store")
      .send(buildTasksCalendar(event));
  });

  fastify.get("/api/events/:eventId/tasks", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.list(eventId, request.workspaceId, request.userRole);
  });

  fastify.get("/api/events/:eventId/task-categories", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listCategories(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/task-categories", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = taskCategorySchema.parse(request.body);
    const category = await service.createCategory(eventId, request.workspaceId, request.userRole, data);
    return reply.status(201).send(category);
  });

  fastify.put("/api/events/:eventId/task-categories/:id", async (request) => {
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    const data = taskCategorySchema.parse(request.body);
    return service.updateCategory(eventId, id, request.workspaceId, request.userRole, data);
  });

  fastify.delete("/api/events/:eventId/task-categories/:id", async (request) => {
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    return service.deleteCategory(eventId, id, request.workspaceId, request.userRole);
  });

  fastify.get("/api/events/:eventId/tasks/calendar.ics", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const event = await service.findEventForCalendar(eventId, request.workspaceId, request.userRole);
    return reply
      .type("text/calendar; charset=utf-8")
      .header("content-disposition", `attachment; filename="abregi-taches-${event.id}.ics"`)
      .header("cache-control", "private, no-store")
      .send(buildTasksCalendar(event));
  });

  fastify.get("/api/events/:eventId/tasks/calendar-subscription", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const subscription = await service.getCalendarSubscription(
      eventId,
      request.workspaceId,
      request.userRole,
    );
    return { token: subscription.token };
  });

  fastify.post("/api/events/:eventId/tasks", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = taskSchema.parse(request.body);
    const { task, autoRunOfShowItem } = await service.create(
      eventId,
      request.workspaceId,
      request.userRole,
      request.user!.id,
      data,
    );
    return reply.status(201).send({ ...task, autoRunOfShowItem });
  });

  fastify.put("/api/events/:eventId/tasks/:id", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    const data = taskSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.put("/api/tasks/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = taskSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.patch("/api/events/:eventId/tasks/:id/status", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    const data = taskStatusSchema.parse(request.body);
    return service.updateStatus(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.patch("/api/tasks/:id/status", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = taskStatusSchema.parse(request.body);
    return service.updateStatus(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.post("/api/tasks/:id/comments", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = taskCommentSchema.parse(request.body);
    const comment = await service.addComment(id, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(comment);
  });

  fastify.post("/api/tasks/:id/attachments", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = taskAttachmentSchema.parse(request.body);
    const attachment = await service.addAttachment(id, request.workspaceId, request.userRole, data);
    return reply.status(201).send(attachment);
  });

  fastify.delete("/api/tasks/:id/attachments/:attachmentId", async (request) => {
    const { id, attachmentId } = attachmentParamsSchema.parse(request.params);
    return service.deleteAttachment(id, attachmentId, request.workspaceId, request.userRole);
  });

  fastify.delete("/api/events/:eventId/tasks/:id", async (request) => {
    const { id } = eventItemParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole);
  });

  fastify.delete("/api/tasks/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole);
  });
}
