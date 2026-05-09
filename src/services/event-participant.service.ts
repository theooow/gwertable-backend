import type { UserRole } from "@prisma/client";
import { requireCan, can } from "../lib/permissions.js";
import type { ParticipantInput } from "../schemas/participant.js";
import { EventParticipantRepository } from "../repositories/event-participant.repository.js";

/**
 * Service métier pour le domaine participant d'événement.
 * Applique les contrôles de permissions avant de déléguer au {@link EventParticipantRepository}.
 */
export class EventParticipantService {
  constructor(private readonly participantRepository: EventParticipantRepository) {}

  /**
   * Retourne la liste des participants d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async list(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "participant.read");
    return this.participantRepository.listParticipants(eventId, workspaceId);
  }

  /**
   * Crée un participant dans un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async create(eventId: string, workspaceId: string, role: UserRole, data: ParticipantInput) {
    requireCan(role, "participant.write");
    return this.participantRepository.create(eventId, workspaceId, data);
  }

  /**
   * Met à jour un participant.
   *
   * @param id - Identifiant du participant
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de mise à jour
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async update(id: string, workspaceId: string, role: UserRole, data: ParticipantInput) {
    requireCan(role, "participant.write");
    return this.participantRepository.update(id, workspaceId, data);
  }

  /**
   * Supprime un participant.
   *
   * @param id - Identifiant du participant
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async delete(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "participant.write");
    return this.participantRepository.delete(id, workspaceId);
  }

  /**
   * Retourne si l'utilisateur peut voir les champs sensibles (cachet, notes internes).
   *
   * @param role - Rôle de l'utilisateur courant
   */
  canSeeSensitive(role: UserRole): boolean {
    return can(role, "budget.read");
  }

  /**
   * Retourne les personnes participant à un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async listPersons(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "participant.read");
    return this.participantRepository.listPersons(eventId, workspaceId);
  }
}
