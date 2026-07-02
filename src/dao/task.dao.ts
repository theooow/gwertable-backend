import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

type TaskAssigneeRow = {
  taskId: string;
  personId: string;
  fullName: string;
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
    const assignees = await findAssignees(this.prisma, tasks.map((task) => task.id));
    return tasks.map((task) => ({ ...task, assignees: assignees.get(task.id) ?? [] }));
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
      select: { id: true },
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
    return {
      ...event,
      tasks: event.tasks.map((task) => ({ ...task, assignees: assignees.get(task.id) ?? [] })),
    };
  }
}
