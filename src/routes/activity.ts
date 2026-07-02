import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { activityPreferencesSchema } from "../schemas/activity.js";
import { ActivityRepository } from "../repositories/activity.repository.js";
import { ActivityService } from "../services/activity.service.js";

const querySchema = z.object({ eventId: z.string().min(1).optional() });

const service = new ActivityService(new ActivityRepository(prisma));

export async function activityRoutes(fastify: FastifyInstance) {
  fastify.get("/api/activity", async (request) => {
    const { eventId } = querySchema.parse(request.query);
    return service.list(request.workspaceId, request.user!.id, request.userRole, eventId);
  });

  fastify.put("/api/activity/preferences", async (request) => {
    const data = activityPreferencesSchema.parse(request.body);
    return service.updatePreferences(request.workspaceId, request.user!.id, request.userRole, data);
  });

  fastify.post("/api/activity/mark-read", async (request) => {
    return service.markAllRead(request.workspaceId, request.user!.id, request.userRole);
  });
}
