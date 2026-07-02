import crypto from "node:crypto";
import type { PrismaClient, Prisma, TaskStatus, Priority } from "@prisma/client";
import { NotFoundError } from "../lib/errors.js";
import { getParisDayKey } from "../lib/calendar.js";
import { TaskDao } from "../dao/task.dao.js";
import { TaskCalendarSubscriptionDao } from "../dao/task-calendar-subscription.dao.js";

type TaskInput = {
  title: string;
  description?: string | null;
  category: string;
  status: TaskStatus;
  priority: Priority;
  tags?: string[];
  checklist?: Prisma.InputJsonValue;
  dueAt?: string | null;
  assigneeId?: string | null;
  assigneeIds?: string[];
};

type TaskAssigneeRow = {
  personId: string;
  fullName: string;
};

type TaskLabelRow = {
  id: string;
  eventId: string;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
};

type TaskAttachmentInput = {
  label: string;
  url: string;
  contentType: string;
  size: number;
};

type TaskAttachmentRow = TaskAttachmentInput & {
  id: string;
  taskId: string;
  createdAt: Date;
};

type TaskCommentRow = {
  id: string;
  taskId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string } | null;
};

const defaultLabelColors = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#be123c", "#4b5563"];
const defaultTaskLabels = [
  "logistique",
  "communication",
  "technique",
  "artistique",
  "administratif",
  "courses",
  "autre",
];

function colorForLabel(name: string) {
  const sum = [...name].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return defaultLabelColors[sum % defaultLabelColors.length];
}

async function ensureTaskLabels(tx: Pick<PrismaClient, "$executeRaw">, eventId: string, names: string[]) {
  for (const name of [...new Set(names.map((item) => item.trim()).filter(Boolean))]) {
    await tx.$executeRaw`
      INSERT INTO "TaskLabel" ("id", "eventId", "name", "color", "updatedAt")
      VALUES (${`tasklabel_${crypto.randomUUID()}`}, ${eventId}, ${name}, ${colorForLabel(name)}, CURRENT_TIMESTAMP)
      ON CONFLICT ("eventId", "name") DO NOTHING
    `;
  }
}

async function replaceTaskAssignees(tx: Prisma.TransactionClient, taskId: string, personIds: string[]) {
  await tx.$executeRaw`DELETE FROM "TaskAssignee" WHERE "taskId" = ${taskId}`;
  for (const personId of personIds) {
    await tx.$executeRaw`
      INSERT INTO "TaskAssignee" ("taskId", "personId")
      VALUES (${taskId}, ${personId})
      ON CONFLICT DO NOTHING
    `;
  }
}

async function findTaskAssignees(tx: Prisma.TransactionClient, taskId: string) {
  const rows = await tx.$queryRaw<TaskAssigneeRow[]>`
    SELECT p."id" AS "personId", p."fullName"
    FROM "TaskAssignee" ta
    JOIN "Person" p ON p."id" = ta."personId"
    WHERE ta."taskId" = ${taskId}
    ORDER BY ta."createdAt" ASC
  `;
  return rows.map((row) => ({ person: { id: row.personId, fullName: row.fullName } }));
}

/**
 * Synchronise l'élément du conducteur lié à une tâche dans une transaction.
 * Crée, met à jour ou supprime l'élément selon la date d'échéance et le jour de l'événement.
 *
 * @param tx - Client Prisma transactionnel
 * @param task - Données de la tâche après création/mise à jour
 */
async function syncRunOfShowItemForTask(
  tx: Prisma.TransactionClient,
  task: {
    id: string;
    eventId: string;
    title: string;
    description: string | null;
    dueAt: Date | null;
    assigneeId: string | null;
  },
) {
  const existing = await tx.runOfShowItem.findUnique({
    where: { sourceTaskId: task.id },
    select: { id: true },
  });

  if (!task.dueAt) {
    if (existing) await tx.runOfShowItem.delete({ where: { id: existing.id } });
    return null;
  }

  if (existing) {
    return tx.runOfShowItem.update({
      where: { id: existing.id },
      data: {
        startsAt: task.dueAt,
        title: task.title,
        responsiblePersonId: task.assigneeId,
        notes: task.description,
      },
      include: {
        responsiblePerson: { select: { id: true, fullName: true } },
        sourceTask: { select: { id: true, title: true } },
      },
    });
  }

  const event = await tx.event.findFirst({
    where: { id: task.eventId },
    select: { startsAt: true },
  });
  if (!event || getParisDayKey(event.startsAt) !== getParisDayKey(task.dueAt)) return null;

  return tx.runOfShowItem.create({
    data: {
      eventId: task.eventId,
      startsAt: task.dueAt,
      durationMin: 30,
      title: task.title,
      responsiblePersonId: task.assigneeId,
      notes: task.description,
      sourceTaskId: task.id,
    },
    include: {
      responsiblePerson: { select: { id: true, fullName: true } },
      sourceTask: { select: { id: true, title: true } },
    },
  });
}

/**
 * Repository pour le domaine tâche.
 * Orchestre le CRUD et la synchronisation bidirectionnelle avec le conducteur.
 */
export class TaskRepository {
  constructor(
    private readonly taskDao: TaskDao,
    private readonly subscriptionDao: TaskCalendarSubscriptionDao,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Vérifie qu'un événement appartient à l'espace de travail.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async assertEventInWorkspace(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");
  }

  /**
   * Vérifie qu'une tâche appartient à l'espace de travail.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async assertTaskInWorkspace(id: string, workspaceId: string) {
    return this.taskDao.findByIdOrThrow(id, workspaceId);
  }

  /**
   * Vérifie qu'une personne appartient à l'espace de travail (si fournie).
   *
   * @param personId - Identifiant optionnel de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async assertPeopleIfProvided(personIds: string[], workspaceId: string) {
    if (personIds.length === 0) return;
    const people = await this.prisma.person.findMany({
      where: { id: { in: personIds }, workspaceId },
      select: { id: true },
    });
    if (people.length !== new Set(personIds).size) throw new NotFoundError("Personne introuvable");
  }

  /**
   * Retourne les tâches d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listTasks(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    await this.ensureLabelsFromTasks(eventId);
    return this.taskDao.findMany(eventId, workspaceId);
  }

  async ensureLabelsFromTasks(eventId: string) {
    const existingLabels = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "TaskLabel"
      WHERE "eventId" = ${eventId}
    `;
    if ((existingLabels[0]?.count ?? 0n) === 0n) {
      await ensureTaskLabels(this.prisma, eventId, defaultTaskLabels);
    }

    const rows = await this.prisma.task.findMany({
      where: { eventId },
      select: { tags: true },
    });
    const names = rows.flatMap((row) => row.tags);
    await ensureTaskLabels(this.prisma, eventId, names);
  }

  async listLabels(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    await this.ensureLabelsFromTasks(eventId);
    return this.prisma.$queryRaw<TaskLabelRow[]>`
      SELECT "id", "eventId", "name", "color", "createdAt", "updatedAt"
      FROM "TaskLabel"
      WHERE "eventId" = ${eventId}
      ORDER BY lower("name") ASC
    `;
  }

  async createLabel(eventId: string, workspaceId: string, data: { name: string; color: string }) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const id = `tasklabel_${crypto.randomUUID()}`;
    const rows = await this.prisma.$queryRaw<TaskLabelRow[]>`
      INSERT INTO "TaskLabel" ("id", "eventId", "name", "color", "updatedAt")
      VALUES (${id}, ${eventId}, ${data.name}, ${data.color}, CURRENT_TIMESTAMP)
      ON CONFLICT ("eventId", "name") DO UPDATE
      SET "color" = EXCLUDED."color", "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "id", "eventId", "name", "color", "createdAt", "updatedAt"
    `;
    return rows[0];
  }

  async updateLabel(eventId: string, workspaceId: string, id: string, data: { name: string; color: string }) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const existing = await this.prisma.$queryRaw<TaskLabelRow[]>`
      SELECT "id", "eventId", "name", "color", "createdAt", "updatedAt"
      FROM "TaskLabel"
      WHERE "id" = ${id} AND "eventId" = ${eventId}
      LIMIT 1
    `;
    if (!existing[0]) throw new NotFoundError("Etiquette introuvable");
    const previousName = existing[0].name;
    const rows = await this.prisma.$queryRaw<TaskLabelRow[]>`
      UPDATE "TaskLabel"
      SET "name" = ${data.name}, "color" = ${data.color}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} AND "eventId" = ${eventId}
      RETURNING "id", "eventId", "name", "color", "createdAt", "updatedAt"
    `;
    if (previousName !== data.name) {
      await this.prisma.$executeRaw`
        UPDATE "Task"
        SET "tags" = array_replace("tags", ${previousName}, ${data.name})
        WHERE "eventId" = ${eventId}
      `;
    }
    return rows[0];
  }

  async deleteLabel(eventId: string, workspaceId: string, id: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const existing = await this.prisma.$queryRaw<TaskLabelRow[]>`
      DELETE FROM "TaskLabel"
      WHERE "id" = ${id} AND "eventId" = ${eventId}
      RETURNING "name"
    `;
    if (!existing[0]) throw new NotFoundError("Etiquette introuvable");
    await this.prisma.$executeRaw`
      UPDATE "Task"
      SET "tags" = array_remove("tags", ${existing[0].name})
      WHERE "eventId" = ${eventId}
    `;
    return { ok: true };
  }

  /**
   * Crée une tâche et synchronise l'élément du conducteur si applicable.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   * @returns `{ task, autoRunOfShowItem }` — l'élément du conducteur peut être `null`
   */
  async create(eventId: string, workspaceId: string, userId: string, data: TaskInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const assigneeIds = [...new Set([...(data.assigneeIds ?? []), ...(data.assigneeId ? [data.assigneeId] : [])])];
    await this.assertPeopleIfProvided(assigneeIds, workspaceId);

    return this.prisma.$transaction(async (tx) => {
      await ensureTaskLabels(tx, eventId, data.tags ?? []);
      const task = await tx.task.create({
        data: {
          eventId,
          title: data.title,
          description: data.description || null,
          category: data.category,
          status: data.status,
          priority: data.priority,
          tags: data.tags ?? [],
          checklist: data.checklist ?? [],
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          assigneeId: assigneeIds[0] ?? null,
        },
        include: {
          assignee: { select: { id: true, fullName: true } },
        },
      });
      await replaceTaskAssignees(tx, task.id, assigneeIds);
      await tx.$executeRaw`
        UPDATE "Task"
        SET "createdByUserId" = ${userId}, "updatedByUserId" = ${userId}
        WHERE "id" = ${task.id}
      `;
      const autoRunOfShowItem = await syncRunOfShowItemForTask(tx, task);
      return { task: { ...task, assignees: await findTaskAssignees(tx, task.id) }, autoRunOfShowItem };
    });
  }

  /**
   * Met à jour une tâche et synchronise l'élément du conducteur.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async update(id: string, workspaceId: string, userId: string, data: TaskInput) {
    await this.assertTaskInWorkspace(id, workspaceId);
    const assigneeIds = [...new Set([...(data.assigneeIds ?? []), ...(data.assigneeId ? [data.assigneeId] : [])])];
    await this.assertPeopleIfProvided(assigneeIds, workspaceId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.task.findUniqueOrThrow({ where: { id }, select: { eventId: true } });
      await ensureTaskLabels(tx, existing.eventId, data.tags ?? []);
      const task = await tx.task.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description || null,
          category: data.category,
          status: data.status,
          priority: data.priority,
          tags: data.tags ?? [],
          checklist: data.checklist ?? [],
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          assigneeId: assigneeIds[0] ?? null,
        },
      });
      await replaceTaskAssignees(tx, id, assigneeIds);
      await tx.$executeRaw`
        UPDATE "Task"
        SET "updatedByUserId" = ${userId}
        WHERE "id" = ${id}
      `;
      await syncRunOfShowItemForTask(tx, task);
      const updated = await tx.task.findUniqueOrThrow({
        where: { id },
        include: {
          assignee: { select: { id: true, fullName: true } },
        },
      });
      return { ...updated, assignees: await findTaskAssignees(tx, id) };
    });
  }

  /**
   * Met à jour uniquement le statut d'une tâche.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @param status - Nouveau statut
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async updateStatus(id: string, workspaceId: string, userId: string, status: TaskStatus) {
    await this.assertTaskInWorkspace(id, workspaceId);
    const task = await this.prisma.task.update({ where: { id }, data: { status } });
    await this.prisma.$executeRaw`
      UPDATE "Task"
      SET "updatedByUserId" = ${userId}
      WHERE "id" = ${id}
    `;
    return task;
  }

  async addComment(id: string, workspaceId: string, userId: string, body: string) {
    await this.assertTaskInWorkspace(id, workspaceId);
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      taskId: string;
      body: string;
      createdAt: Date;
      updatedAt: Date;
      authorId: string | null;
      authorName: string | null;
    }>>`
      INSERT INTO "TaskComment" ("id", "taskId", "authorId", "body", "updatedAt")
      VALUES (${`taskcomment_${crypto.randomUUID()}`}, ${id}, ${userId}, ${body}, CURRENT_TIMESTAMP)
      RETURNING
        "id",
        "taskId",
        "body",
        "createdAt",
        "updatedAt",
        "authorId",
        (
          SELECT COALESCE(NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), ''), u."name", u."email")
          FROM "User" u
          WHERE u."id" = "TaskComment"."authorId"
        ) AS "authorName"
    `;
    await this.prisma.$executeRaw`
      UPDATE "Task"
      SET "updatedByUserId" = ${userId}
      WHERE "id" = ${id}
    `;
    const row = rows[0]!;
    return {
      id: row.id,
      taskId: row.taskId,
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: row.authorId && row.authorName ? { id: row.authorId, name: row.authorName } : null,
    } satisfies TaskCommentRow;
  }

  async addAttachment(id: string, workspaceId: string, data: TaskAttachmentInput) {
    await this.assertTaskInWorkspace(id, workspaceId);
    const rows = await this.prisma.$queryRaw<TaskAttachmentRow[]>`
      INSERT INTO "TaskAttachment" ("id", "taskId", "label", "url", "contentType", "size")
      VALUES (${`taskatt_${crypto.randomUUID()}`}, ${id}, ${data.label}, ${data.url}, ${data.contentType}, ${data.size})
      RETURNING "id", "taskId", "label", "url", "contentType", "size", "createdAt"
    `;
    return rows[0];
  }

  async deleteAttachment(id: string, attachmentId: string, workspaceId: string) {
    await this.assertTaskInWorkspace(id, workspaceId);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      DELETE FROM "TaskAttachment"
      WHERE "id" = ${attachmentId} AND "taskId" = ${id}
      RETURNING "id"
    `;
    if (!rows[0]) throw new NotFoundError("Piece jointe introuvable");
    return { ok: true };
  }

  /**
   * Supprime une tâche et l'élément du conducteur lié si présent.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async delete(id: string, workspaceId: string) {
    await this.assertTaskInWorkspace(id, workspaceId);
    return this.prisma.$transaction(async (tx) => {
      const linked = await tx.runOfShowItem.findUnique({
        where: { sourceTaskId: id },
        select: { id: true },
      });
      if (linked) await tx.runOfShowItem.delete({ where: { id: linked.id } });
      return tx.task.delete({ where: { id } });
    });
  }

  /**
   * Retourne ou crée l'abonnement de calendrier ICS pour un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async getCalendarSubscription(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.subscriptionDao.upsert(eventId);
  }

  /**
   * Retourne les données d'un événement pour la génération ICS.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async findEventForCalendar(eventId: string, workspaceId: string) {
    const event = await this.taskDao.findEventForCalendar(eventId, workspaceId);
    if (!event) throw new NotFoundError("Evenement introuvable");
    return event;
  }

  /**
   * Retourne les données d'un événement via le token d'abonnement calendrier.
   *
   * @param token - Token d'abonnement
   * @throws {NotFoundError} Si l'abonnement est introuvable
   */
  async findEventForCalendarByToken(token: string) {
    const subscription = await this.subscriptionDao.findByToken(token);
    if (!subscription) throw new NotFoundError("Abonnement calendrier introuvable");
    return this.findEventForCalendar(subscription.eventId, subscription.event.workspaceId);
  }
}
