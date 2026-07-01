import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { eventNotificationSettingsSchema } from "../../schemas/notification.js";
import { NotificationRepository } from "../../repositories/notification.repository.js";
import { NotificationService } from "../../services/notification.service.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });

const service = new NotificationService(new NotificationRepository(prisma));

export async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events/:eventId/notifications", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.getSettings(eventId, request.workspaceId, request.userRole);
  });

  fastify.put("/api/events/:eventId/notifications", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = eventNotificationSettingsSchema.parse(request.body);
    return service.updateSettings(eventId, request.workspaceId, request.userRole, data);
  });
}
