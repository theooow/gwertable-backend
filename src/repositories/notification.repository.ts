import type { PrismaClient } from "@prisma/client";
import { NotFoundError } from "../lib/errors.js";
import type { EventNotificationSettingsInput } from "../schemas/notification.js";

const defaultSettings = {
  enabled: false,
  discordChannelId: null,
  hasDiscordBotToken: false,
  whatsappEnabled: false,
  taskReminderOffsetsMinutes: [1440, 60],
  runOfShowReminderOffsetsMinutes: [30],
  overdueEnabled: true,
} satisfies {
  enabled: boolean;
  discordChannelId: string | null;
  hasDiscordBotToken: boolean;
  whatsappEnabled: boolean;
  taskReminderOffsetsMinutes: number[];
  runOfShowReminderOffsetsMinutes: number[];
  overdueEnabled: boolean;
};

function serializeSettings(settings: {
  id: string | null;
  eventId: string;
  enabled: boolean;
  discordChannelId: string | null;
  discordBotToken?: string | null;
  whatsappEnabled: boolean;
  taskReminderOffsetsMinutes: number[];
  runOfShowReminderOffsetsMinutes: number[];
  overdueEnabled: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}) {
  const { discordBotToken, ...rest } = settings;
  return { ...rest, hasDiscordBotToken: Boolean(discordBotToken) };
}

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
    return serializeSettings(settings ?? { id: null, eventId, ...defaultSettings, discordBotToken: null, createdAt: null, updatedAt: null });
  }

  async upsertSettings(eventId: string, workspaceId: string, data: EventNotificationSettingsInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const discordBotToken = data.discordBotToken?.trim();
    const settings = await this.prisma.eventNotificationSettings.upsert({
      where: { eventId },
      create: {
        eventId,
        enabled: data.enabled,
        discordChannelId: data.discordChannelId || null,
        discordBotToken: discordBotToken || null,
        whatsappEnabled: data.whatsappEnabled,
        taskReminderOffsetsMinutes: data.taskReminderOffsetsMinutes,
        runOfShowReminderOffsetsMinutes: data.runOfShowReminderOffsetsMinutes,
        overdueEnabled: data.overdueEnabled,
      },
      update: {
        enabled: data.enabled,
        discordChannelId: data.discordChannelId || null,
        ...(discordBotToken ? { discordBotToken } : {}),
        whatsappEnabled: data.whatsappEnabled,
        taskReminderOffsetsMinutes: data.taskReminderOffsetsMinutes,
        runOfShowReminderOffsetsMinutes: data.runOfShowReminderOffsetsMinutes,
        overdueEnabled: data.overdueEnabled,
      },
    });
    return serializeSettings(settings);
  }
}
