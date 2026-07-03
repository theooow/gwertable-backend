import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type { z } from "zod";
import type { runOfShowSchema, runOfShowSectionSchema, runOfShowTrackSchema } from "../schemas/run-of-show.js";
import { RunOfShowRepository } from "../repositories/run-of-show.repository.js";

type RunOfShowInput = z.infer<typeof runOfShowSchema>;
type RunOfShowTrackInput = z.infer<typeof runOfShowTrackSchema>;
type RunOfShowSectionInput = z.infer<typeof runOfShowSectionSchema>;

/**
 * Service métier pour le domaine conducteur de show (run-of-show).
 * Applique les contrôles de permissions avant de déléguer au {@link RunOfShowRepository}.
 */
export class RunOfShowService {
  constructor(private readonly runOfShowRepository: RunOfShowRepository) {}

  /**
   * Retourne les éléments du conducteur d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async list(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "runOfShow.read");
    return this.runOfShowRepository.listItems(eventId, workspaceId);
  }

  async listTracks(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "runOfShow.read");
    return this.runOfShowRepository.listTracks(eventId, workspaceId);
  }

  async createTrack(
    eventId: string,
    workspaceId: string,
    role: UserRole,
    userId: string,
    data: RunOfShowTrackInput,
  ) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.createTrack(eventId, workspaceId, userId, data);
  }

  async updateTrack(
    id: string,
    workspaceId: string,
    role: UserRole,
    userId: string,
    data: RunOfShowTrackInput,
  ) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.updateTrack(id, workspaceId, userId, data);
  }

  async deleteTrack(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.deleteTrack(id, workspaceId, userId);
  }

  async listSections(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "runOfShow.read");
    return this.runOfShowRepository.listSections(eventId, workspaceId);
  }

  async createSection(
    eventId: string,
    workspaceId: string,
    role: UserRole,
    userId: string,
    data: RunOfShowSectionInput,
  ) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.createSection(eventId, workspaceId, userId, data);
  }

  async updateSection(
    id: string,
    workspaceId: string,
    role: UserRole,
    userId: string,
    data: RunOfShowSectionInput,
  ) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.updateSection(id, workspaceId, userId, data);
  }

  async deleteSection(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.deleteSection(id, workspaceId, userId);
  }

  /**
   * Crée un élément du conducteur.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async create(
    eventId: string,
    workspaceId: string,
    role: UserRole,
    userId: string,
    data: RunOfShowInput,
  ) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.create(eventId, workspaceId, userId, data);
  }

  /**
   * Met à jour un élément du conducteur avec synchronisation de la tâche liée.
   *
   * @param id - Identifiant de l'élément
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de mise à jour
   * @param eventId - Identifiant optionnel de l'événement
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async update(
    id: string,
    workspaceId: string,
    role: UserRole,
    userId: string,
    data: RunOfShowInput,
    eventId?: string,
  ) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.update(id, workspaceId, userId, data, eventId);
  }

  /**
   * Supprime un élément du conducteur et la tâche source si liée.
   *
   * @param id - Identifiant de l'élément
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param eventId - Identifiant optionnel de l'événement
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async delete(id: string, workspaceId: string, role: UserRole, userId: string, eventId?: string) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.delete(id, workspaceId, userId, eventId);
  }
}
