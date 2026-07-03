import type { Prisma, PrismaClient } from "@prisma/client";

export type ActivityNotificationType =
  | "TASK_CREATED"
  | "TASK_UPDATED"
  | "TASK_STATUS_UPDATED"
  | "TASK_COMMENT"
  | "TASK_DUE_SOON"
  | "EXPENSE_CREATED"
  | "EXPENSE_UPDATED"
  | "EXPENSE_DELETED"
  | "INCOME_CREATED"
  | "INCOME_UPDATED"
  | "INCOME_DELETED";

type RecordActivityInput = {
  workspaceId: string;
  eventId?: string | null;
  actorId?: string | null;
  type: ActivityNotificationType;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  notify?: boolean;
};

type Preference = {
  taskCommentsEnabled: boolean;
  budgetChangesEnabled: boolean;
  taskDueSoonEnabled: boolean;
};

const defaultPreference: Preference = {
  taskCommentsEnabled: true,
  budgetChangesEnabled: true,
  taskDueSoonEnabled: true,
};

function isEnabled(type: ActivityNotificationType, preference: Preference) {
  if (type.startsWith("TASK_") && type !== "TASK_DUE_SOON") return preference.taskCommentsEnabled;
  if (type.startsWith("EXPENSE_") || type.startsWith("INCOME_")) return preference.budgetChangesEnabled;
  if (type === "TASK_DUE_SOON") return preference.taskDueSoonEnabled;
  return true;
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}

export class ActivityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(workspaceId: string, userId: string, eventId?: string) {
    const [activities, notifications, unreadCount, preferences] = await Promise.all([
      this.prisma.activityEntry.findMany({
        where: { workspaceId, ...(eventId ? { eventId } : {}) },
        orderBy: { createdAt: "desc" },
        take: 80,
        include: {
          actor: { select: { id: true, email: true, name: true, firstName: true, lastName: true, image: true } },
          event: { select: { id: true, name: true } },
        },
      }),
      this.prisma.inAppNotification.findMany({
        where: { workspaceId, userId, ...(eventId ? { eventId } : {}) },
        orderBy: { createdAt: "desc" },
        take: 40,
        include: {
          event: { select: { id: true, name: true } },
          activity: {
            include: {
              actor: { select: { id: true, email: true, name: true, firstName: true, lastName: true, image: true } },
              event: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.inAppNotification.count({
        where: { workspaceId, userId, readAt: null, ...(eventId ? { eventId } : {}) },
      }),
      this.getPreferences(workspaceId, userId),
    ]);

    return { activities, notifications, unreadCount, preferences };
  }

  async getPreferences(workspaceId: string, userId: string) {
    return this.prisma.activityNotificationPreference.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId },
      update: {},
    });
  }

  async updatePreferences(
    workspaceId: string,
    userId: string,
    data: {
      taskCommentsEnabled: boolean;
      budgetChangesEnabled: boolean;
      taskDueSoonEnabled: boolean;
      taskDueSoonMinutes: number;
    },
  ) {
    return this.prisma.activityNotificationPreference.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, ...data },
      update: data,
    });
  }

  async markAllRead(workspaceId: string, userId: string) {
    await this.prisma.inAppNotification.updateMany({
      where: { workspaceId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async record(input: RecordActivityInput) {
    const activity = await this.prisma.activityEntry.create({
      data: {
        workspaceId: input.workspaceId,
        eventId: input.eventId ?? null,
        actorId: input.actorId ?? null,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {},
      },
      select: { id: true },
    });

    if (input.notify === false) return activity;

    const recipients = await this.findRecipients(input.workspaceId, input.eventId ?? null);
    const userIds = recipients.filter((userId) => userId !== input.actorId);
    if (userIds.length === 0) return activity;

    const preferences = await this.prisma.activityNotificationPreference.findMany({
      where: { workspaceId: input.workspaceId, userId: { in: userIds } },
    });
    const preferenceByUserId = new Map(preferences.map((preference) => [preference.userId, preference]));
    const enabledUserIds = userIds.filter((userId) => isEnabled(input.type, preferenceByUserId.get(userId) ?? defaultPreference));

    if (enabledUserIds.length === 0) return activity;

    await this.prisma.inAppNotification.createMany({
      data: enabledUserIds.map((userId) => ({
        workspaceId: input.workspaceId,
        eventId: input.eventId ?? null,
        userId,
        activityId: activity.id,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
      })),
    });

    return activity;
  }

  private async findRecipients(workspaceId: string, eventId: string | null) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true },
    });
    const collaboratorUserIds = eventId
      ? await this.prisma.eventCollaborator.findMany({
          where: { workspaceId, eventId, acceptedAt: { not: null }, userId: { not: null } },
          select: { userId: true },
        })
      : [];

    return [...new Set([...members.map((member) => member.userId), ...collaboratorUserIds.map((item) => item.userId).filter(isString)])];
  }
}
