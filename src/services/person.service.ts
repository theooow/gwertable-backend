import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type { PersonInput } from "../schemas/person.js";
import { PersonRepository } from "../repositories/person.repository.js";
import type { PersonFilters } from "../dao/person.dao.js";

/**
 * Service métier pour le domaine personne.
 * Applique les contrôles de permissions avant de déléguer au {@link PersonRepository}.
 */
export class PersonService {
  constructor(private readonly personRepository: PersonRepository) {}

  /**
   * Retourne la liste des personnes de l'espace de travail courant.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param filters - Filtres de recherche
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async list(workspaceId: string, role: UserRole, filters: PersonFilters = {}) {
    requireCan(role, "person.read");
    return this.personRepository.listForWorkspace(workspaceId, filters);
  }

  /**
   * Retourne les personnes actives d'un espace de travail accessible par l'utilisateur.
   * Utilisé pour les requêtes inter-workspace (ex. collaborateurs d'événement).
   *
   * @param workspaceId - Identifiant de l'espace de travail cible
   * @param role - Rôle de l'utilisateur courant
   * @param userId - Identifiant de l'utilisateur courant
   * @param userEmail - Email de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   * @throws {NotFoundError} Si l'utilisateur n'a pas accès à cet espace de travail
   */
  async listForAccessibleWorkspace(
    workspaceId: string,
    role: UserRole,
    userId: string,
    userEmail: string,
  ) {
    requireCan(role, "person.read");
    return this.personRepository.listForAccessibleWorkspace(workspaceId, userId, userEmail);
  }

  /**
   * Retourne les tags utilisés dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async listTags(workspaceId: string, role: UserRole) {
    requireCan(role, "person.read");
    return this.personRepository.getTagsForWorkspace(workspaceId);
  }

  /**
   * Retourne une personne par son identifiant.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async get(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "person.read");
    return this.personRepository.getOrThrow(id, workspaceId);
  }

  /**
   * Crée une personne dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de la personne
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async create(workspaceId: string, role: UserRole, data: PersonInput) {
    requireCan(role, "person.write");
    return this.personRepository.create(workspaceId, data);
  }

  /**
   * Met à jour une personne existante.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de mise à jour
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async update(id: string, workspaceId: string, role: UserRole, data: PersonInput) {
    requireCan(role, "person.write");
    return this.personRepository.update(id, workspaceId, data);
  }

  /**
   * Archive une personne (suppression logique).
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async archive(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "person.write");
    return this.personRepository.archive(id, workspaceId);
  }

  /**
   * Restaure une personne archivée.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async restore(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "person.write");
    return this.personRepository.restore(id, workspaceId);
  }
}
