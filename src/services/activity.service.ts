import type { z } from "zod";
import { requireCan } from "../lib/permissions.js";
import type { activityPreferencesSchema, activityQuerySchema } from "../schemas/activity.js";
import { ActivityRepository, type ActivityViewer } from "../repositories/activity.repository.js";

type ActivityPreferencesInput = z.infer<typeof activityPreferencesSchema>;
type ActivityQuery = z.infer<typeof activityQuerySchema>;

export class ActivityService {
  constructor(private readonly activityRepository: ActivityRepository) {}

  async list(workspaceId: string, viewer: ActivityViewer, query: ActivityQuery) {
    requireCan(viewer.role, "event.read");
    return this.activityRepository.list(workspaceId, viewer, {
      eventId: query.eventId,
      category: query.category,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  async updatePreferences(workspaceId: string, viewer: ActivityViewer, data: ActivityPreferencesInput) {
    requireCan(viewer.role, "event.read");
    return this.activityRepository.updatePreferences(workspaceId, viewer.userId, data);
  }

  async markAllRead(workspaceId: string, viewer: ActivityViewer) {
    requireCan(viewer.role, "event.read");
    return this.activityRepository.markAllRead(workspaceId, viewer.userId);
  }

  async markRead(workspaceId: string, viewer: ActivityViewer, id: string) {
    requireCan(viewer.role, "event.read");
    return this.activityRepository.markRead(workspaceId, viewer.userId, id);
  }
}
