import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type { z } from "zod";
import type { taskAttachmentSchema, taskCommentSchema, taskLabelSchema, taskSchema, taskStatusSchema } from "../schemas/task.js";
import { TaskRepository } from "../repositories/task.repository.js";

type TaskInput = z.infer<typeof taskSchema>;
type TaskStatusInput = z.infer<typeof taskStatusSchema>;
type TaskLabelInput = z.infer<typeof taskLabelSchema>;
type TaskAttachmentInput = z.infer<typeof taskAttachmentSchema>;
type TaskCommentInput = z.infer<typeof taskCommentSchema>;

/**
 * Service métier pour le domaine tâche.
 * Applique les contrôles de permissions avant de déléguer au {@link TaskRepository}.
 */
export class TaskService {
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * Retourne les tâches d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async list(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "task.read");
    return this.taskRepository.listTasks(eventId, workspaceId);
  }

  async listLabels(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "task.read");
    return this.taskRepository.listLabels(eventId, workspaceId);
  }

  async createLabel(eventId: string, workspaceId: string, role: UserRole, data: TaskLabelInput) {
    requireCan(role, "task.write");
    return this.taskRepository.createLabel(eventId, workspaceId, data);
  }

  async updateLabel(eventId: string, labelId: string, workspaceId: string, role: UserRole, data: TaskLabelInput) {
    requireCan(role, "task.write");
    return this.taskRepository.updateLabel(eventId, workspaceId, labelId, data);
  }

  async deleteLabel(eventId: string, labelId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "task.write");
    return this.taskRepository.deleteLabel(eventId, workspaceId, labelId);
  }

  /**
   * Crée une tâche avec synchronisation du conducteur.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async create(eventId: string, workspaceId: string, role: UserRole, userId: string, data: TaskInput) {
    requireCan(role, "task.write");
    return this.taskRepository.create(eventId, workspaceId, userId, data);
  }

  /**
   * Met à jour une tâche avec synchronisation du conducteur.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de mise à jour
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async update(id: string, workspaceId: string, role: UserRole, userId: string, data: TaskInput) {
    requireCan(role, "task.write");
    return this.taskRepository.update(id, workspaceId, userId, data);
  }

  /**
   * Met à jour le statut d'une tâche.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Statut validé
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async updateStatus(id: string, workspaceId: string, role: UserRole, userId: string, data: TaskStatusInput) {
    requireCan(role, "task.write");
    return this.taskRepository.updateStatus(id, workspaceId, userId, data.status);
  }

  async addComment(id: string, workspaceId: string, role: UserRole, userId: string, data: TaskCommentInput) {
    requireCan(role, "task.write");
    return this.taskRepository.addComment(id, workspaceId, userId, data.body);
  }

  async addAttachment(id: string, workspaceId: string, role: UserRole, data: TaskAttachmentInput) {
    requireCan(role, "task.write");
    return this.taskRepository.addAttachment(id, workspaceId, data);
  }

  async deleteAttachment(id: string, attachmentId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "task.write");
    return this.taskRepository.deleteAttachment(id, attachmentId, workspaceId);
  }

  /**
   * Supprime une tâche et l'élément du conducteur lié.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async delete(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "task.write");
    return this.taskRepository.delete(id, workspaceId);
  }

  /**
   * Retourne ou crée l'abonnement de calendrier ICS pour un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async getCalendarSubscription(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "task.read");
    return this.taskRepository.getCalendarSubscription(eventId, workspaceId);
  }

  /**
   * Retourne les données d'un événement pour la génération du calendrier ICS.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async findEventForCalendar(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "task.read");
    return this.taskRepository.findEventForCalendar(eventId, workspaceId);
  }

  /**
   * Retourne les données d'un événement via le token d'abonnement calendrier public.
   *
   * @param token - Token d'abonnement
   */
  async findEventForCalendarByToken(token: string) {
    return this.taskRepository.findEventForCalendarByToken(token);
  }
}
