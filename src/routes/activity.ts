import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../prisma.js";
import { activityNotificationParamsSchema, activityPreferencesSchema, activityQuerySchema } from "../schemas/activity.js";
import { ActivityRepository, type ActivityViewer } from "../repositories/activity.repository.js";
import { ActivityService } from "../services/activity.service.js";

const service = new ActivityService(new ActivityRepository(prisma));

function viewerOf(request: FastifyRequest): ActivityViewer {
  return { userId: request.user!.id, email: request.user!.email, role: request.userRole, eventScoped: request.eventScoped };
}

export async function activityRoutes(fastify: FastifyInstance) {
  fastify.get("/api/activity", { config: { documentation: { querystring: activityQuerySchema } } }, async (request) => {
    const query = activityQuerySchema.parse(request.query);
    return service.list(request.workspaceId, viewerOf(request), query);
  });

  fastify.put("/api/activity/preferences", { config: { documentation: { body: activityPreferencesSchema } } }, async (request) => {
    const data = activityPreferencesSchema.parse(request.body);
    return service.updatePreferences(request.workspaceId, viewerOf(request), data);
  });

  fastify.post("/api/activity/mark-read", { config: { documentation: {  } } }, async (request) => {
    return service.markAllRead(request.workspaceId, viewerOf(request));
  });

  fastify.post("/api/activity/notifications/:id/read", { config: { documentation: { params: activityNotificationParamsSchema } } }, async (request) => {
    const { id } = activityNotificationParamsSchema.parse(request.params);
    return service.markRead(request.workspaceId, viewerOf(request), id);
  });
}
