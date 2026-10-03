import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import {
  activityCategoryOf,
  activityPreferenceOf,
  canSeeActivityCategory,
  visibleActivityTypes,
  type ActivityCategory,
  type ActivityNotificationType,
  type ActivityPreferenceKey,
} from "../lib/activity-catalog.js";

export type { ActivityNotificationType } from "../lib/activity-catalog.js";

export type RecordActivityInput = {
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

export type ActivityViewer = {
  userId: string;
  email: string;
  role: UserRole;
  eventScoped: boolean;
};

export type ActivityListFilters = {
  eventId?: string;
  category?: ActivityCategory;
  cursor?: string;
  limit: number;
};

type Preference = Record<ActivityPreferenceKey, boolean>;

type VisibilityFilter = { type: { in: string[] } } | { OR: { eventId: string; type: { in: string[] } }[] };

const defaultPreference: Preference = {
  taskCommentsEnabled: true,
  taskDueSoonEnabled: true,
  budgetChangesEnabled: true,
  equipmentChangesEnabled: true,
  volunteerChangesEnabled: true,
};

const actorSelect = { id: true, email: true, name: true, firstName: true, lastName: true, image: true } as const;

function isEnabled(type: ActivityNotificationType, preference: Preference) {
  const key = activityPreferenceOf(type);
  return key ? preference[key] : true;
}

export class ActivityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(workspaceId: string, viewer: ActivityViewer, filters: ActivityListFilters) {
    const visibility = await this.visibilityFilter(workspaceId, viewer, filters.category);
    const eventFilter = filters.eventId ? { eventId: filters.eventId } : {};
    const notificationWhere = { workspaceId, userId: viewer.userId, ...eventFilter, AND: [visibility] };

    const [entries, notifications, unreadCount, preferences] = await Promise.all([
      this.prisma.activityEntry.findMany({
        where: {
          workspaceId,
          ...eventFilter,
          AND: [visibility],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filters.limit + 1,
        ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
        include: { actor: { select: actorSelect }, event: { select: { id: true, name: true } } },
      }),
      this.prisma.inAppNotification.findMany({
        where: notificationWhere,
        orderBy: { createdAt: "desc" },
        take: 40,
        include: {
          event: { select: { id: true, name: true } },
          activity: { include: { actor: { select: actorSelect }, event: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.inAppNotification.count({ where: { ...notificationWhere, readAt: null } }),
      this.getPreferences(workspaceId, viewer.userId),
    ]);

    const activities = entries.slice(0, filters.limit);
    const nextCursor = entries.length > filters.limit ? activities.at(-1)?.id ?? null : null;
    return {
      activities: activities.map((entry) => ({ ...entry, category: activityCategoryOf(entry.type) })),
      notifications: notifications.map((notification) => ({ ...notification, category: activityCategoryOf(notification.type) })),
      unreadCount,
      preferences,
      nextCursor,
    };
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
    data: Partial<Preference> & { taskDueSoonMinutes: number },
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

  async markRead(workspaceId: string, userId: string, id: string) {
    const { count } = await this.prisma.inAppNotification.updateMany({
      where: { id, workspaceId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, updated: count };
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

    const category = activityCategoryOf(input.type);
    const recipients = await this.findRecipients(input.workspaceId, input.eventId ?? null, category);
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

  /** Collaborators only see the events they were invited to, with the role of each invitation. */
  private async visibilityFilter(workspaceId: string, viewer: ActivityViewer, category?: ActivityCategory): Promise<VisibilityFilter> {
    const categories = category ? [category] : undefined;
    if (!viewer.eventScoped) return { type: { in: visibleActivityTypes(viewer.role, categories) } };

    const invitations = await this.prisma.eventCollaborator.findMany({
      where: { workspaceId, acceptedAt: { not: null }, OR: [{ userId: viewer.userId }, { email: viewer.email }] },
      select: { eventId: true, role: true },
    });
    return {
      OR: invitations.map((invitation) => ({
        eventId: invitation.eventId,
        type: { in: visibleActivityTypes(invitation.role, categories) },
      })),
    };
  }

  private async findRecipients(workspaceId: string, eventId: string | null, category: ActivityCategory | null) {
    const allowed = ({ role }: { role: UserRole }) => !category || canSeeActivityCategory(role, category);
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true, role: true },
    });
    const collaborators = eventId
      ? await this.prisma.eventCollaborator.findMany({
          where: { workspaceId, eventId, acceptedAt: { not: null }, userId: { not: null } },
          select: { userId: true, role: true },
        })
      : [];

    const userIds = [
      ...members.filter(allowed).map((member) => member.userId),
      ...collaborators.filter(allowed).flatMap((collaborator) => (collaborator.userId ? [collaborator.userId] : [])),
    ];
    return [...new Set(userIds)];
  }
}
