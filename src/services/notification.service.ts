import type { UsagePlan, UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import { requirePlanFeature } from "../lib/usage-plans.js";
import type { EventNotificationSettingsInput } from "../schemas/notification.js";
import { NotificationRepository } from "../repositories/notification.repository.js";

export class NotificationService {
  constructor(private readonly notificationRepository: NotificationRepository) {}

  async getSettings(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "event.read");
    return this.notificationRepository.getSettings(eventId, workspaceId);
  }

  async updateSettings(
    eventId: string,
    workspaceId: string,
    role: UserRole,
    usagePlan: UsagePlan,
    data: EventNotificationSettingsInput,
  ) {
    requireCan(role, "event.write");
    if (data.whatsappEnabled) {
      requirePlanFeature(usagePlan, "whatsapp.notifications");
    }
    return this.notificationRepository.upsertSettings(eventId, workspaceId, data);
  }
}
