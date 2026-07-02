import type { UserRole } from "@prisma/client";
import type { z } from "zod";
import { requireCan } from "../lib/permissions.js";
import type { activityPreferencesSchema } from "../schemas/activity.js";
import { ActivityRepository } from "../repositories/activity.repository.js";

type ActivityPreferencesInput = z.infer<typeof activityPreferencesSchema>;

export class ActivityService {
  constructor(private readonly activityRepository: ActivityRepository) {}

  async list(workspaceId: string, userId: string, role: UserRole, eventId?: string) {
    requireCan(role, "event.read");
    return this.activityRepository.list(workspaceId, userId, eventId);
  }

  async updatePreferences(workspaceId: string, userId: string, role: UserRole, data: ActivityPreferencesInput) {
    requireCan(role, "event.read");
    return this.activityRepository.updatePreferences(workspaceId, userId, data);
  }

  async markAllRead(workspaceId: string, userId: string, role: UserRole) {
    requireCan(role, "event.read");
    return this.activityRepository.markAllRead(workspaceId, userId);
  }
}
