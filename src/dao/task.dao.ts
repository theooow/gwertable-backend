import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

type TaskAssigneeRow = {
  taskId: string;
  personId: string;
  fullName: string;
};

type TaskAttachmentRow = {
  id: string;
  taskId: string;
  label: string;
  url: string;
  contentType: string;
  size: number;
  createdAt: Date;
};

type TaskActorRow = {
  taskId: string;
  createdByUserId: string | null;
  createdByName: string | null;
  updatedByUserId: string | null;
  updatedByName: string | null;
};

type TaskCommentRow = {
  id: string;
  taskId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string } | null;
};

async function findAssignees(prisma: PrismaClient, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, Array<{ person: { id: string; fullName: string } }>>();
  const rows = await prisma.$queryRaw<TaskAssigneeRow[]>`
    SELECT ta."taskId", p."id" AS "personId", p."fullName"
    FROM "TaskAssignee" ta
    JOIN "Person" p ON p."id" = ta."personId"
    WHERE ta."taskId" = ANY(${taskIds})
    ORDER BY ta."createdAt" ASC
  `;
  const byTask = new Map<string, Array<{ person: { id: string; fullName: string } }>>();
  for (const row of rows) {
    const current = byTask.get(row.taskId) ?? [];
    current.push({ person: { id: row.personId, fullName: row.fullName } });
    byTask.set(row.taskId, current);
  }
  return byTask;
}

async function findAttachments(prisma: PrismaClient, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, TaskAttachmentRow[]>();
  const rows = await prisma.$queryRaw<TaskAttachmentRow[]>`
    SELECT "id", "taskId", "label", "url", "contentType", "size", "createdAt"
    FROM "TaskAttachment"
    WHERE "taskId" = ANY(${taskIds})
    ORDER BY "createdAt" ASC
  `;
  const byTask = new Map<string, TaskAttachmentRow[]>();
  for (const row of rows) {
    const current = byTask.get(row.taskId) ?? [];
    current.push(row);
    byTask.set(row.taskId, current);
  }
  return byTask;
}

async function findActors(prisma: PrismaClient, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, TaskActorRow>();
  const rows = await prisma.$queryRaw<TaskActorRow[]>`
    SELECT
      t."id" AS "taskId",
      cu."id" AS "createdByUserId",
      COALESCE(NULLIF(TRIM(CONCAT(cu."firstName", ' ', cu."lastName")), ''), cu."name", cu."email") AS "createdByName",
      uu."id" AS "updatedByUserId",
      COALESCE(NULLIF(TRIM(CONCAT(uu."firstName", ' ', uu."lastName")), ''), uu."name", uu."email") AS "updatedByName"
    FROM "Task" t
    LEFT JOIN "User" cu ON cu."id" = t."createdByUserId"
    LEFT JOIN "User" uu ON uu."id" = t."updatedByUserId"
    WHERE t."id" = ANY(${taskIds})
  `;
  return new Map(rows.map((row) => [row.taskId, row]));
}

async function findComments(prisma: PrismaClient, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, TaskCommentRow[]>();
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    taskId: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    authorId: string | null;
    authorName: string | null;
  }>>`
    SELECT
      c."id",
      c."taskId",
      c."body",
      c."createdAt",
      c."updatedAt",
      u."id" AS "authorId",
      COALESCE(NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), ''), u."name", u."email") AS "authorName"
    FROM "TaskComment" c
    LEFT JOIN "User" u ON u."id" = c."authorId"
    WHERE c."taskId" = ANY(${taskIds})
    ORDER BY c."createdAt" ASC
  `;
  const byTask = new Map<string, TaskCommentRow[]>();
  for (const row of rows) {
    const current = byTask.get(row.taskId) ?? [];
    current.push({
      id: row.id,
      taskId: row.taskId,
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: row.authorId && row.authorName ? { id: row.authorId, name: row.authorName } : null,
    });
    byTask.set(row.taskId, current);
  }
  return byTask;
}

/**
 * DAO pour le modèle {@link Task}.
 * Fournit les opérations CRUD sur les tâches d'un événement.
 */
export class TaskDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Retourne les tâches d'un événement triées par date d'échéance, priorité et création.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findMany(eventId: string, workspaceId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { eventId, event: { workspaceId } },
      include: {
        assignee: { select: { id: true, fullName: true } },
      },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    });
    const taskIds = tasks.map((task) => task.id);
    const assignees = await findAssignees(this.prisma, taskIds);
    const attachments = await findAttachments(this.prisma, taskIds);
    const actors = await findActors(this.prisma, taskIds);
    const comments = await findComments(this.prisma, taskIds);
    return tasks.map((task) => ({
      ...task,
      assignees: assignees.get(task.id) ?? [],
      attachments: attachments.get(task.id) ?? [],
      createdByUser: actors.get(task.id)?.createdByUserId
        ? { id: actors.get(task.id)!.createdByUserId!, name: actors.get(task.id)!.createdByName ?? "Utilisateur" }
        : null,
      updatedByUser: actors.get(task.id)?.updatedByUserId
        ? { id: actors.get(task.id)!.updatedByUserId!, name: actors.get(task.id)!.updatedByName ?? "Utilisateur" }
        : null,
      comments: comments.get(task.id) ?? [],
    }));
  }

  /**
   * Recherche une tâche par son identifiant dans un espace de travail.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns La tâche ou `null` si absente
   */
  async findByIdInWorkspace(id: string, workspaceId: string) {
    return this.prisma.task.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true, eventId: true, title: true },
    });
  }

  /**
   * Recherche une tâche ou lève une erreur.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async findByIdOrThrow(id: string, workspaceId: string) {
    const task = await this.findByIdInWorkspace(id, workspaceId);
    if (!task) throw new NotFoundError("Tache introuvable");
    return task;
  }

  /**
   * Retourne les données d'un événement avec ses tâches pour la génération ICS.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns L'événement avec ses tâches, ou `null` si absent
   */
  async findEventForCalendar(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: {
        id: true,
        name: true,
        tasks: {
          where: { dueAt: { not: null } },
          include: {
            assignee: { select: { fullName: true } },
          },
          orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
        },
      },
    });
    if (!event) return null;
    const assignees = await findAssignees(this.prisma, event.tasks.map((task) => task.id));
    const attachments = await findAttachments(this.prisma, event.tasks.map((task) => task.id));
    return {
      ...event,
      tasks: event.tasks.map((task) => ({
        ...task,
        assignees: assignees.get(task.id) ?? [],
        attachments: attachments.get(task.id) ?? [],
      })),
    };
  }
}
