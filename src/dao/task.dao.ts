import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

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
    return this.prisma.task.findMany({
      where: { eventId, event: { workspaceId } },
      include: { assignee: { select: { id: true, fullName: true } } },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    });
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
    return this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: {
        id: true,
        name: true,
        tasks: {
          where: { dueAt: { not: null } },
          include: { assignee: { select: { fullName: true } } },
          orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
        },
      },
    });
  }
}
