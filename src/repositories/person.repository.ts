import type { PrismaClient } from "@prisma/client";
import type { PersonInput } from "../schemas/person.js";
import { NotFoundError } from "../lib/errors.js";
import { PersonDao, type PersonFilters } from "../dao/person.dao.js";

/**
 * Repository pour le domaine personne.
 * Expose les opérations métier et délègue l'accès aux données à {@link PersonDao}.
 *
 * Note : la vérification d'accès inter-workspace (`assertReadAccess`) utilise
 * le client Prisma directement jusqu'à la création des DAOs workspace/collaborateur
 * (Phase 4 et 5).
 */
export class PersonRepository {
  constructor(
    private readonly personDao: PersonDao,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Retourne les personnes d'un espace de travail avec filtres optionnels.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param filters - Filtres de recherche
   */
  async listForWorkspace(workspaceId: string, filters: PersonFilters = {}) {
    return this.personDao.findMany(workspaceId, filters);
  }

  /**
   * Retourne les personnes actives d'un espace de travail accessible par l'utilisateur
   * (membre direct ou collaborateur d'événement).
   *
   * @param workspaceId - Identifiant de l'espace de travail cible
   * @param userId - Identifiant de l'utilisateur courant
   * @param userEmail - Email de l'utilisateur courant
   * @throws {NotFoundError} Si l'utilisateur n'a aucun accès à cet espace de travail
   */
  async listForAccessibleWorkspace(workspaceId: string, userId: string, userEmail: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });

    if (!member) {
      const collaborator = await this.prisma.eventCollaborator.findFirst({
        where: {
          workspaceId,
          acceptedAt: { not: null },
          OR: [{ userId }, { email: userEmail }],
        },
        select: { id: true },
      });

      if (!collaborator) throw new NotFoundError("Workspace introuvable");
    }

    return this.personDao.findMany(workspaceId, { includeArchived: false });
  }

  /**
   * Retourne les tags utilisés dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async getTagsForWorkspace(workspaceId: string) {
    return this.personDao.findTags(workspaceId);
  }

  /**
   * Retourne une personne ou lève une {@link NotFoundError}.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async getOrThrow(id: string, workspaceId: string) {
    return this.personDao.findByIdOrThrow(id, workspaceId);
  }

  /**
   * Crée une personne dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async create(workspaceId: string, data: PersonInput) {
    return this.personDao.create(workspaceId, data);
  }

  /**
   * Met à jour une personne après vérification de son existence.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async update(id: string, workspaceId: string, data: PersonInput) {
    await this.personDao.findByIdOrThrow(id, workspaceId);
    return this.personDao.update(id, workspaceId, data);
  }

  /**
   * Archive une personne (suppression logique).
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async archive(id: string, workspaceId: string) {
    await this.personDao.findByIdOrThrow(id, workspaceId);
    return this.personDao.setArchivedAt(id, workspaceId, new Date());
  }

  /**
   * Restaure une personne archivée.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async restore(id: string, workspaceId: string) {
    await this.personDao.findByIdOrThrow(id, workspaceId);
    return this.personDao.setArchivedAt(id, workspaceId, null);
  }
}
