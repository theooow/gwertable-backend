import crypto from "node:crypto";
import type { PrismaClient, Prisma, TaskStatus, Priority } from "@prisma/client";
import { NotFoundError } from "../lib/errors.js";
import { getParisDayKey } from "../lib/calendar.js";
import { TaskDao } from "../dao/task.dao.js";
import { TaskCalendarSubscriptionDao } from "../dao/task-calendar-subscription.dao.js";
import { ActivityRepository } from "./activity.repository.js";

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

type TaskCategoryRow = {
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

const defaultCategoryColors = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#be123c", "#4b5563"];
const defaultTaskCategories = [
  "logistique",
  "communication",
  "technique",
  "artistique",
  "administratif",
  "courses",
  "autre",
];

function colorForCategory(name: string) {
  const sum = [...name].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return defaultCategoryColors[sum % defaultCategoryColors.length];
}

function formatActivityDate(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function ensureTaskCategories(tx: Pick<PrismaClient, "$executeRaw">, eventId: string, names: string[]) {
  for (const name of [...new Set(names.map((item) => item.trim()).filter(Boolean))]) {
    await tx.$executeRaw`
      INSERT INTO "TaskCategory" ("id", "eventId", "name", "color", "updatedAt")
      VALUES (${`taskcategory_${crypto.randomUUID()}`}, ${eventId}, ${name}, ${colorForCategory(name)}, CURRENT_TIMESTAMP)
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
  private readonly activityRepository: ActivityRepository;

  constructor(
    private readonly taskDao: TaskDao,
    private readonly subscriptionDao: TaskCalendarSubscriptionDao,
    private readonly prisma: PrismaClient,
  ) {
    this.activityRepository = new ActivityRepository(prisma);
  }

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
    await this.ensureCategoriesFromTasks(eventId);
    return this.taskDao.findMany(eventId, workspaceId);
  }

  async ensureCategoriesFromTasks(eventId: string) {
    const existingCategories = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "TaskCategory"
      WHERE "eventId" = ${eventId}
    `;
    if ((existingCategories[0]?.count ?? 0n) === 0n) {
      await ensureTaskCategories(this.prisma, eventId, defaultTaskCategories);
    }

    const rows = await this.prisma.task.findMany({
      where: { eventId },
      select: { category: true, tags: true },
    });
    const names = rows.flatMap((row) => [row.category, ...row.tags]);
    await ensureTaskCategories(this.prisma, eventId, names);
  }

  async listCategories(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    await this.ensureCategoriesFromTasks(eventId);
    return this.prisma.$queryRaw<TaskCategoryRow[]>`
      SELECT "id", "eventId", "name", "color", "createdAt", "updatedAt"
      FROM "TaskCategory"
      WHERE "eventId" = ${eventId}
      ORDER BY lower("name") ASC
    `;
  }

  async createCategory(eventId: string, workspaceId: string, userId: string, data: { name: string; color: string }) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const id = `taskcategory_${crypto.randomUUID()}`;
    const rows = await this.prisma.$queryRaw<TaskCategoryRow[]>`
      INSERT INTO "TaskCategory" ("id", "eventId", "name", "color", "updatedAt")
      VALUES (${id}, ${eventId}, ${data.name}, ${data.color}, CURRENT_TIMESTAMP)
      ON CONFLICT ("eventId", "name") DO UPDATE
      SET "color" = EXCLUDED."color", "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "id", "eventId", "name", "color", "createdAt", "updatedAt"
    `;
    const category = rows[0];
    await this.activityRepository.record({
      workspaceId,
      eventId,
      actorId: userId,
      type: "TASK_CATEGORY_CREATED",
      title: `Catégorie de tâche créée : ${category.name}`,
      entityType: "TASK_CATEGORY",
      entityId: category.id,
      notify: false,
    });
    return category;
  }

  async updateCategory(eventId: string, workspaceId: string, userId: string, id: string, data: { name: string; color: string }) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const existing = await this.prisma.$queryRaw<TaskCategoryRow[]>`
      SELECT "id", "eventId", "name", "color", "createdAt", "updatedAt"
      FROM "TaskCategory"
      WHERE "id" = ${id} AND "eventId" = ${eventId}
      LIMIT 1
    `;
    if (!existing[0]) throw new NotFoundError("Categorie introuvable");
    const previousName = existing[0].name;
    const rows = await this.prisma.$queryRaw<TaskCategoryRow[]>`
      UPDATE "TaskCategory"
      SET "name" = ${data.name}, "color" = ${data.color}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} AND "eventId" = ${eventId}
      RETURNING "id", "eventId", "name", "color", "createdAt", "updatedAt"
    `;
    if (previousName !== data.name) {
      await this.prisma.$executeRaw`
        UPDATE "Task"
        SET
          "tags" = array_replace("tags", ${previousName}, ${data.name}),
          "category" = CASE WHEN "category" = ${previousName} THEN ${data.name} ELSE "category" END
        WHERE "eventId" = ${eventId}
      `;
    }
    const category = rows[0];
    await this.activityRepository.record({
      workspaceId,
      eventId,
      actorId: userId,
      type: "TASK_CATEGORY_UPDATED",
      title: `Catégorie de tâche modifiée : ${category.name}`,
      entityType: "TASK_CATEGORY",
      entityId: category.id,
      notify: false,
    });
    return category;
  }

  async deleteCategory(eventId: string, workspaceId: string, userId: string, id: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const existing = await this.prisma.$queryRaw<TaskCategoryRow[]>`
      DELETE FROM "TaskCategory"
      WHERE "id" = ${id} AND "eventId" = ${eventId}
      RETURNING "name"
    `;
    if (!existing[0]) throw new NotFoundError("Categorie introuvable");
    await this.prisma.$executeRaw`
      UPDATE "Task"
      SET
        "tags" = array_remove("tags", ${existing[0].name}),
        "category" = CASE
          WHEN "category" = ${existing[0].name}
          THEN COALESCE((array_remove("tags", ${existing[0].name}))[1], 'autre')
          ELSE "category"
        END
      WHERE "eventId" = ${eventId}
    `;
    await this.activityRepository.record({
      workspaceId,
      eventId,
      actorId: userId,
      type: "TASK_CATEGORY_DELETED",
      title: `Catégorie de tâche supprimée : ${existing[0].name}`,
      entityType: "TASK_CATEGORY",
      entityId: id,
      notify: false,
    });
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

    const result = await this.prisma.$transaction(async (tx) => {
      await ensureTaskCategories(tx, eventId, data.tags ?? []);
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
    await this.activityRepository.record({
      workspaceId,
      eventId,
      actorId: userId,
      type: "TASK_CREATED",
      title: `Tâche créée : ${result.task.title}`,
      body: result.task.dueAt ? `Échéance : ${formatActivityDate(result.task.dueAt)}` : null,
      entityType: "TASK",
      entityId: result.task.id,
      notify: false,
    });
    return result;
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

    const updatedTask = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.task.findUniqueOrThrow({ where: { id }, select: { eventId: true } });
      await ensureTaskCategories(tx, existing.eventId, data.tags ?? []);
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
    await this.activityRepository.record({
      workspaceId,
      eventId: updatedTask.eventId,
      actorId: userId,
      type: "TASK_UPDATED",
      title: `Tâche modifiée : ${updatedTask.title}`,
      entityType: "TASK",
      entityId: updatedTask.id,
      notify: false,
    });
    return updatedTask;
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
    await this.activityRepository.record({
      workspaceId,
      eventId: task.eventId,
      actorId: userId,
      type: "TASK_STATUS_UPDATED",
      title: `Statut de tâche modifié : ${task.title}`,
      body: `Nouveau statut : ${status}`,
      entityType: "TASK",
      entityId: task.id,
      notify: false,
    });
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
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true, title: true, eventId: true },
    });
    if (task) {
      await this.activityRepository.record({
        workspaceId,
        eventId: task.eventId,
        actorId: userId,
        type: "TASK_COMMENT",
        title: `Nouveau commentaire sur ${task.title}`,
        body,
        entityType: "TASK",
        entityId: task.id,
      });
    }
    return {
      id: row.id,
      taskId: row.taskId,
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: row.authorId && row.authorName ? { id: row.authorId, name: row.authorName } : null,
    } satisfies TaskCommentRow;
  }

  async addAttachment(id: string, workspaceId: string, userId: string, data: TaskAttachmentInput) {
    const task = await this.assertTaskInWorkspace(id, workspaceId);
    const rows = await this.prisma.$queryRaw<TaskAttachmentRow[]>`
      INSERT INTO "TaskAttachment" ("id", "taskId", "label", "url", "contentType", "size")
      VALUES (${`taskatt_${crypto.randomUUID()}`}, ${id}, ${data.label}, ${data.url}, ${data.contentType}, ${data.size})
      RETURNING "id", "taskId", "label", "url", "contentType", "size", "createdAt"
    `;
    const attachment = rows[0];
    await this.activityRepository.record({
      workspaceId,
      eventId: task.eventId,
      actorId: userId,
      type: "TASK_ATTACHMENT_CREATED",
      title: `Pièce jointe ajoutée : ${attachment.label}`,
      entityType: "TASK",
      entityId: task.id,
      notify: false,
    });
    return attachment;
  }

  async deleteAttachment(id: string, attachmentId: string, workspaceId: string, userId: string) {
    const task = await this.assertTaskInWorkspace(id, workspaceId);
    const rows = await this.prisma.$queryRaw<{ id: string; label: string }[]>`
      DELETE FROM "TaskAttachment"
      WHERE "id" = ${attachmentId} AND "taskId" = ${id}
      RETURNING "id", "label"
    `;
    if (!rows[0]) throw new NotFoundError("Piece jointe introuvable");
    await this.activityRepository.record({
      workspaceId,
      eventId: task.eventId,
      actorId: userId,
      type: "TASK_ATTACHMENT_DELETED",
      title: `Pièce jointe supprimée : ${rows[0].label}`,
      entityType: "TASK",
      entityId: task.id,
      notify: false,
    });
    return { ok: true };
  }

  /**
   * Supprime une tâche et l'élément du conducteur lié si présent.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async delete(id: string, workspaceId: string, userId: string) {
    const task = await this.assertTaskInWorkspace(id, workspaceId);
    const deleted = await this.prisma.$transaction(async (tx) => {
      const linked = await tx.runOfShowItem.findUnique({
        where: { sourceTaskId: id },
        select: { id: true },
      });
      if (linked) await tx.runOfShowItem.delete({ where: { id: linked.id } });
      return tx.task.delete({ where: { id } });
    });
    await this.activityRepository.record({
      workspaceId,
      eventId: task.eventId,
      actorId: userId,
      type: "TASK_DELETED",
      title: `Tâche supprimée : ${task.title}`,
      entityType: "TASK",
      entityId: task.id,
      notify: false,
    });
    return deleted;
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
