import type { PrismaClient } from "@prisma/client";
import type { PersonInput } from "../schemas/person.js";
import { NotFoundError } from "../lib/errors.js";
import { removeUploadedFiles } from "../lib/upload-files.js";
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
   * Efface une personne à la demande (droit à l'effacement).
   * Supprime la fiche, ou l'anonymise lorsqu'un contrat de bénévolat, une annonce
   * ou un compte utilisateur doit être conservé. Les montants budgétaires restent.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async erase(id: string, workspaceId: string): Promise<"deleted" | "anonymized"> {
    const person = await this.prisma.person.findFirst({
      where: { id, workspaceId, anonymizedAt: null },
      include: { user: { select: { id: true } }, documents: true, _count: { select: { volunteerContracts: true, announcements: true } } },
    });
    if (!person) throw new NotFoundError("Personne introuvable");
    const keep = Boolean(person.user) || person._count.volunteerContracts > 0 || person._count.announcements > 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.activityEntry.deleteMany({ where: { workspaceId, entityType: "PERSON", entityId: id } });
      if (keep) {
        await tx.personDocument.deleteMany({ where: { personId: id } });
        await tx.personHistoryNote.deleteMany({ where: { personId: id } });
        await tx.volunteerApplication.updateMany({ where: { personId: id }, data: {
          fullName: "Contact supprimé", email: null, phone: "", dietary: "NONE", answers: [], accessToken: null, badgeToken: null,
        } });
        await tx.person.update({ where: { id }, data: {
          fullName: "Contact supprimé", email: null, phone: null, address: null, discordUserId: null, flags: [], tags: [],
          availability: null, negotiatedPrices: null, specialConditions: null, technicalConstraints: null, averageFee: null,
          bookingContact: null, musicalStyle: null, riderNotes: null, venueCapacity: null, soundConstraints: null,
          openingHours: null, electricalPower: null, securityContact: null, sensibleNeighborhood: false,
          archivedAt: person.archivedAt ?? new Date(), anonymizedAt: new Date(),
        } });
        return;
      }
      await tx.expense.updateMany({ where: { sourceParticipant: { personId: id } }, data: { sourceParticipantId: null } });
      await tx.expense.updateMany({ where: { paidById: id }, data: { paidById: null } });
      await tx.task.updateMany({ where: { assigneeId: id }, data: { assigneeId: null } });
      await tx.shift.updateMany({ where: { assigneeId: id }, data: { assigneeId: null } });
      await tx.shoppingItem.updateMany({ where: { buyerId: id }, data: { buyerId: null } });
      await tx.equipmentItem.updateMany({ where: { ownerId: id }, data: { ownerId: null } });
      await tx.runOfShowItem.updateMany({ where: { responsiblePersonId: id }, data: { responsiblePersonId: null } });
      await tx.volunteerSwap.deleteMany({ where: { targetPersonId: id } });
      await tx.volunteerApplication.deleteMany({ where: { personId: id } });
      await tx.eventParticipant.deleteMany({ where: { personId: id } });
      await tx.person.delete({ where: { id } });
    });
    await removeUploadedFiles(person.documents.filter((d) => d.isUpload).map((d) => d.url));
    return keep ? "anonymized" : "deleted";
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
