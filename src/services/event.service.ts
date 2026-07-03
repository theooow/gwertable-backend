import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type { EventInput } from "../schemas/event.js";
import { EventRepository, type CollaboratorContext } from "../repositories/event.repository.js";

/**
 * Service métier pour le domaine événement.
 * Applique les contrôles de permissions avant de déléguer au {@link EventRepository}.
 */
export class EventService {
  constructor(private readonly eventRepository: EventRepository) {}

  /**
   * Retourne la liste des événements de l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param collaborator - Contexte collaborateur si l'utilisateur est en mode `eventScoped`
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async list(workspaceId: string, role: UserRole, collaborator?: CollaboratorContext) {
    requireCan(role, "event.read");
    return this.eventRepository.listEvents(workspaceId, collaborator);
  }

  /**
   * Retourne un événement par son identifiant.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param collaborator - Contexte collaborateur si l'utilisateur est en mode `eventScoped`
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   * @throws {NotFoundError} Si l'événement est introuvable ou inaccessible
   */
  async get(
    id: string,
    workspaceId: string,
    role: UserRole,
    collaborator?: CollaboratorContext,
  ) {
    requireCan(role, "event.read");
    return this.eventRepository.getEventOrThrow(id, workspaceId, collaborator);
  }

  /**
   * Crée un événement dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de l'événement
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   * @throws {NotFoundError} Si le lieu spécifié est introuvable
   */
  async create(workspaceId: string, role: UserRole, userId: string, data: EventInput) {
    requireCan(role, "event.write");
    return this.eventRepository.createEvent(workspaceId, userId, data);
  }

  /**
   * Met à jour un événement existant.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de mise à jour
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   * @throws {NotFoundError} Si l'événement ou le lieu est introuvable
   */
  async update(id: string, workspaceId: string, role: UserRole, userId: string, data: EventInput) {
    requireCan(role, "event.write");
    return this.eventRepository.updateEvent(id, workspaceId, userId, data);
  }

  /**
   * Supprime un événement.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async delete(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "event.write");
    return this.eventRepository.deleteEvent(id, workspaceId, userId);
  }

  /**
   * Retourne la liste des lieux actifs de l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async listVenues(workspaceId: string, role: UserRole) {
    requireCan(role, "event.read");
    return this.eventRepository.listVenues(workspaceId);
  }

  /**
   * Crée un lieu dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param name - Nom du lieu
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async createVenue(workspaceId: string, role: UserRole, name: string) {
    requireCan(role, "event.write");
    return this.eventRepository.createVenue(workspaceId, name);
  }
}
