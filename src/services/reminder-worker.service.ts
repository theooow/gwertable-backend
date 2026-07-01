import type { FastifyBaseLogger } from "fastify";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { env } from "../env.js";
import type { DiscordSender } from "../lib/discord.js";

type ReminderTargetType = "TASK" | "RUN_OF_SHOW";
type ReminderType = "REMINDER" | "OVERDUE";

type ReminderCandidate = {
  eventId: string;
  eventName: string;
  channelId: string;
  targetType: ReminderTargetType;
  targetId: string;
  reminderType: ReminderType;
  offsetMinutes: number;
  scheduledFor: Date;
  happensAt: Date;
  title: string;
  personName: string;
  discordUserId: string;
};

function formatParisDate(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function buildMessage(candidate: ReminderCandidate) {
  const mention = `<@${candidate.discordUserId}>`;
  const targetLabel = candidate.targetType === "TASK" ? "tache" : "run of show";
  if (candidate.reminderType === "OVERDUE") {
    return `${mention} Rappel Abregi - ${candidate.eventName}: la ${targetLabel} "${candidate.title}" etait prevue le ${formatParisDate(candidate.happensAt)} et n'est pas terminee.`;
  }
  return `${mention} Rappel Abregi - ${candidate.eventName}: tu dois effectuer "${candidate.title}" le ${formatParisDate(candidate.happensAt)}.`;
}

function isDue(scheduledFor: Date, now: Date, lookbackMs: number) {
  const time = scheduledFor.getTime();
  return time <= now.getTime() && time >= now.getTime() - lookbackMs;
}

function reminderDate(happensAt: Date, offsetMinutes: number) {
  return new Date(happensAt.getTime() - offsetMinutes * 60_000);
}

export class ReminderWorkerService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: DiscordSender,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async collectDueReminders(now = new Date()) {
    const lookbackMs = env.NOTIFICATION_REMINDER_LOOKBACK_MINUTES * 60_000;
    const settings = await this.prisma.eventNotificationSettings.findMany({
      where: { enabled: true, discordChannelId: { not: null } },
      include: {
        event: {
          include: {
            tasks: {
              where: { dueAt: { not: null }, status: { not: "DONE" }, assignee: { discordUserId: { not: null } } },
              include: { assignee: { select: { fullName: true, discordUserId: true } } },
            },
            runOfShow: {
              where: {
                status: { notIn: ["DONE", "CANCELLED"] },
                responsiblePerson: { discordUserId: { not: null } },
              },
              include: { responsiblePerson: { select: { fullName: true, discordUserId: true } } },
            },
          },
        },
      },
    });

    const candidates: ReminderCandidate[] = [];
    for (const setting of settings) {
      const channelId = setting.discordChannelId;
      if (!channelId) continue;

      for (const task of setting.event.tasks) {
        if (!task.dueAt || !task.assignee?.discordUserId) continue;
        for (const offsetMinutes of setting.taskReminderOffsetsMinutes) {
          const scheduledFor = reminderDate(task.dueAt, offsetMinutes);
          if (!isDue(scheduledFor, now, lookbackMs)) continue;
          candidates.push({
            eventId: setting.eventId,
            eventName: setting.event.name,
            channelId,
            targetType: "TASK",
            targetId: task.id,
            reminderType: "REMINDER",
            offsetMinutes,
            scheduledFor,
            happensAt: task.dueAt,
            title: task.title,
            personName: task.assignee.fullName,
            discordUserId: task.assignee.discordUserId,
          });
        }
        if (setting.overdueEnabled && isDue(task.dueAt, now, lookbackMs)) {
          candidates.push({
            eventId: setting.eventId,
            eventName: setting.event.name,
            channelId,
            targetType: "TASK",
            targetId: task.id,
            reminderType: "OVERDUE",
            offsetMinutes: 0,
            scheduledFor: task.dueAt,
            happensAt: task.dueAt,
            title: task.title,
            personName: task.assignee.fullName,
            discordUserId: task.assignee.discordUserId,
          });
        }
      }

      for (const item of setting.event.runOfShow) {
        if (!item.responsiblePerson?.discordUserId) continue;
        for (const offsetMinutes of setting.runOfShowReminderOffsetsMinutes) {
          const scheduledFor = reminderDate(item.startsAt, offsetMinutes);
          if (!isDue(scheduledFor, now, lookbackMs)) continue;
          candidates.push({
            eventId: setting.eventId,
            eventName: setting.event.name,
            channelId,
            targetType: "RUN_OF_SHOW",
            targetId: item.id,
            reminderType: "REMINDER",
            offsetMinutes,
            scheduledFor,
            happensAt: item.startsAt,
            title: item.title,
            personName: item.responsiblePerson.fullName,
            discordUserId: item.responsiblePerson.discordUserId,
          });
        }
        if (setting.overdueEnabled && isDue(item.startsAt, now, lookbackMs)) {
          candidates.push({
            eventId: setting.eventId,
            eventName: setting.event.name,
            channelId,
            targetType: "RUN_OF_SHOW",
            targetId: item.id,
            reminderType: "OVERDUE",
            offsetMinutes: 0,
            scheduledFor: item.startsAt,
            happensAt: item.startsAt,
            title: item.title,
            personName: item.responsiblePerson.fullName,
            discordUserId: item.responsiblePerson.discordUserId,
          });
        }
      }
    }

    return candidates;
  }

  async runDueReminders(now = new Date()) {
    const candidates = await this.collectDueReminders(now);
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const candidate of candidates) {
      const delivery = await this.createPendingDelivery(candidate);
      if (!delivery) {
        skipped += 1;
        continue;
      }

      try {
        await this.discord.sendMessage({
          channelId: candidate.channelId,
          content: buildMessage(candidate),
        });
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: "SENT", sentAt: new Date() },
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Unknown Discord error";
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: "FAILED", error: message.slice(0, 1000) },
        });
        this.logger?.error({ err: error, candidate }, "Notification reminder failed");
      }
    }

    return { candidates: candidates.length, sent, skipped, failed };
  }

  private async createPendingDelivery(candidate: ReminderCandidate) {
    try {
      return await this.prisma.notificationDelivery.create({
        data: {
          eventId: candidate.eventId,
          targetType: candidate.targetType,
          targetId: candidate.targetId,
          reminderType: candidate.reminderType,
          offsetMinutes: candidate.offsetMinutes,
          scheduledFor: candidate.scheduledFor,
          status: "PENDING",
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
      throw error;
    }
  }
}
