import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { eventNotificationSettingsSchema } from "../../schemas/notification.js";
import { NotificationRepository } from "../../repositories/notification.repository.js";
import { NotificationService } from "../../services/notification.service.js";
import { recordRequestActivity } from "../../lib/activity-recorder.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });

const service = new NotificationService(new NotificationRepository(prisma));

export async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events/:eventId/notifications", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.getSettings(eventId, request.workspaceId, request.userRole);
  });

  fastify.put("/api/events/:eventId/notifications", { config: { documentation: { params: eventParamsSchema, body: eventNotificationSettingsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = eventNotificationSettingsSchema.parse(request.body);
    const settings = await service.updateSettings(eventId, request.workspaceId, request.userRole, request.user!.usagePlan, data);
    await recordRequestActivity(request, {
      eventId, type: "EVENT_NOTIFICATIONS_UPDATED", title: "Rappels et notifications de l'événement modifiés",
      body: data.enabled ? "Rappels activés" : "Rappels désactivés", entityType: "EVENT", entityId: eventId, notify: false,
    });
    return settings;
  });
}
