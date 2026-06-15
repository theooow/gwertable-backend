import type { PrismaClient } from "@prisma/client";
import { NotFoundError } from "../lib/errors.js";
import { parseEuros } from "../lib/money.js";
import { ShoppingDao } from "../dao/shopping.dao.js";

type ShoppingInput = {
  name: string;
  quantity: string;
  unit?: string | null;
  category: string;
  estimatedCents?: string | null;
  buyerId?: string | null;
};

type BoughtWithExpenseInput = {
  amountCents: number;
  paidById?: string | null;
};

/**
 * Repository pour le domaine courses (shopping).
 * Orchestre le CRUD des articles et la création liée de dépenses.
 */
export class ShoppingRepository {
  constructor(
    private readonly shoppingDao: ShoppingDao,
    private readonly prisma: PrismaClient,
  ) {}

  private async assertEventInWorkspace(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");
  }

  private async assertPersonIfProvided(personId: string | undefined | null, workspaceId: string) {
    if (!personId) return;
    const person = await this.prisma.person.findFirst({
      where: { id: personId, workspaceId },
      select: { id: true },
    });
    if (!person) throw new NotFoundError("Personne introuvable");
  }

  /**
   * Retourne les articles de courses d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listItems(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.shoppingDao.findMany(eventId, workspaceId);
  }

  /**
   * Crée un article de courses.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async create(eventId: string, workspaceId: string, data: ShoppingInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    await this.assertPersonIfProvided(data.buyerId, workspaceId);

    return this.prisma.shoppingItem.create({
      data: {
        eventId,
        name: data.name,
        quantity: parseFloat(data.quantity) || 1,
        unit: data.unit || null,
        category: data.category,
        estimatedCents: data.estimatedCents ? parseEuros(data.estimatedCents) : null,
        buyerId: data.buyerId || null,
      },
    });
  }

  /**
   * Met à jour un article de courses.
   *
   * @param id - Identifiant de l'article
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données de mise à jour
   * @throws {NotFoundError} Si l'article est introuvable
   */
  async update(id: string, workspaceId: string, data: ShoppingInput) {
    await this.shoppingDao.findByIdOrThrow(id, workspaceId);
    await this.assertPersonIfProvided(data.buyerId, workspaceId);

    return this.prisma.shoppingItem.update({
      where: { id },
      data: {
        name: data.name,
        quantity: parseFloat(data.quantity) || 1,
        unit: data.unit || null,
        category: data.category,
        estimatedCents: data.estimatedCents ? parseEuros(data.estimatedCents) : null,
        buyerId: data.buyerId || null,
      },
    });
  }

  /**
   * Met à jour le statut "acheté" d'un article.
   *
   * @param id - Identifiant de l'article
   * @param workspaceId - Identifiant de l'espace de travail
   * @param bought - Nouveau statut
   * @throws {NotFoundError} Si l'article est introuvable
   */
  async updateBought(id: string, workspaceId: string, bought: boolean) {
    await this.shoppingDao.findByIdOrThrow(id, workspaceId);
    return this.prisma.shoppingItem.update({ where: { id }, data: { bought } });
  }

  /**
   * Marque un article comme acheté et crée la dépense associée.
   *
   * @param id - Identifiant de l'article
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données de la dépense
   * @param eventId - Identifiant de l'événement (optionnel, utilisé pour validation)
   * @throws {NotFoundError} Si l'article est introuvable
   */
  async buyWithExpense(
    id: string,
    workspaceId: string,
    data: BoughtWithExpenseInput,
    eventId?: string,
  ) {
    if (eventId) await this.assertEventInWorkspace(eventId, workspaceId);
    await this.assertPersonIfProvided(data.paidById, workspaceId);
    const item = await this.shoppingDao.findByIdOrThrow(id, workspaceId);

    const expense = await this.prisma.expense.create({
      data: {
        eventId: eventId ?? item.eventId,
        label: item.name,
        amountCents: data.amountCents,
        amountHtCents: data.amountCents,
        amountTtcCents: data.amountCents,
        category: "courses",
        paidById: data.paidById,
        paidAt: new Date(),
        reimbursement: data.paidById ? "PENDING" : "NOT_OWED",
      },
    });

    await this.prisma.shoppingItem.update({
      where: { id },
      data: { bought: true, expenseId: expense.id },
    });

    return expense;
  }

  /**
   * Supprime un article et la dépense liée si elle existe.
   *
   * @param id - Identifiant de l'article
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'article est introuvable
   */
  async delete(id: string, workspaceId: string) {
    await this.shoppingDao.findByIdOrThrow(id, workspaceId);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.shoppingItem.delete({ where: { id } });
      if (item.expenseId) await tx.expense.delete({ where: { id: item.expenseId } });
      return item;
    });
  }

  /**
   * Retourne les personnes associées aux participants d'un événement pour les courses.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listPersons(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const participants = await this.prisma.eventParticipant.findMany({
      where: { eventId, event: { workspaceId } },
      select: { person: { select: { id: true, fullName: true } } },
      orderBy: { person: { fullName: "asc" } },
    });
    return participants.map((p) => p.person);
  }
}
