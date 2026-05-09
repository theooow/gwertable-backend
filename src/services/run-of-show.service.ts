import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type { z } from "zod";
import type { runOfShowSchema } from "../schemas/run-of-show.js";
import { RunOfShowRepository } from "../repositories/run-of-show.repository.js";

type RunOfShowInput = z.infer<typeof runOfShowSchema>;

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

  /**
   * Crée un élément du conducteur.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async create(eventId: string, workspaceId: string, role: UserRole, data: RunOfShowInput) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.create(eventId, workspaceId, data);
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
    data: RunOfShowInput,
    eventId?: string,
  ) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.update(id, workspaceId, data, eventId);
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
  async delete(id: string, workspaceId: string, role: UserRole, eventId?: string) {
    requireCan(role, "runOfShow.write");
    return this.runOfShowRepository.delete(id, workspaceId, eventId);
  }
}
