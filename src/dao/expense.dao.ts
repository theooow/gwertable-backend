import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

/**
 * DAO pour le modèle {@link Expense}.
 * Fournit les opérations CRUD sur les dépenses d'un événement.
 */
export class ExpenseDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Retourne les dépenses d'un événement triées par date de paiement puis de création.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findMany(eventId: string, workspaceId: string) {
    return this.prisma.expense.findMany({
      where: { eventId, event: { workspaceId } },
      include: { paidBy: { select: { id: true, fullName: true } } },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    });
  }

  /**
   * Recherche une dépense par son identifiant dans un espace de travail.
   *
   * @param id - Identifiant de la dépense
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns La dépense ou `null` si absente
   */
  async findByIdInWorkspace(id: string, workspaceId: string) {
    return this.prisma.expense.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true, sourceParticipantId: true },
    });
  }

  /**
   * Recherche une dépense ou lève une erreur.
   *
   * @param id - Identifiant de la dépense
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la dépense est introuvable
   */
  async findByIdOrThrow(id: string, workspaceId: string) {
    const expense = await this.findByIdInWorkspace(id, workspaceId);
    if (!expense) throw new NotFoundError("Depense introuvable");
    return expense;
  }

  /**
   * Retourne les personnes ayant des dépenses sur un événement (via les participants).
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findPersonsForEvent(eventId: string, workspaceId: string) {
    const participants = await this.prisma.eventParticipant.findMany({
      where: { eventId, event: { workspaceId } },
      select: { person: { select: { id: true, fullName: true } } },
      orderBy: { person: { fullName: "asc" } },
    });
    return participants.map((p) => p.person);
  }
}
