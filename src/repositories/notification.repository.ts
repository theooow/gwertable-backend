import type { PrismaClient } from "@prisma/client";
import { NotFoundError } from "../lib/errors.js";
import type { EventNotificationSettingsInput } from "../schemas/notification.js";

const defaultSettings = {
  enabled: false,
  discordChannelId: null,
  whatsappEnabled: false,
  taskReminderOffsetsMinutes: [1440, 60],
  runOfShowReminderOffsetsMinutes: [30],
  overdueEnabled: true,
} as const;

export class NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async assertEventInWorkspace(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");
  }

  async getSettings(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const settings = await this.prisma.eventNotificationSettings.findUnique({
      where: { eventId },
    });
    return settings ?? { id: null, eventId, ...defaultSettings, createdAt: null, updatedAt: null };
  }

  async upsertSettings(eventId: string, workspaceId: string, data: EventNotificationSettingsInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.prisma.eventNotificationSettings.upsert({
      where: { eventId },
      create: {
        eventId,
        enabled: data.enabled,
        discordChannelId: data.discordChannelId || null,
        whatsappEnabled: data.whatsappEnabled,
        taskReminderOffsetsMinutes: data.taskReminderOffsetsMinutes,
        runOfShowReminderOffsetsMinutes: data.runOfShowReminderOffsetsMinutes,
        overdueEnabled: data.overdueEnabled,
      },
      update: {
        enabled: data.enabled,
        discordChannelId: data.discordChannelId || null,
        whatsappEnabled: data.whatsappEnabled,
        taskReminderOffsetsMinutes: data.taskReminderOffsetsMinutes,
        runOfShowReminderOffsetsMinutes: data.runOfShowReminderOffsetsMinutes,
        overdueEnabled: data.overdueEnabled,
      },
    });
  }
}
