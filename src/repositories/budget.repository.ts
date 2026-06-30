import type {
  PrismaClient,
  Prisma,
  TicketSource,
  ReimbStatus,
  BudgetPhase,
  AmountInputMode,
  VatMode,
} from "@prisma/client";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { parseEuros } from "../lib/money.js";
import {
  fetchShotgunEvents,
  fetchShotgunTickets,
  getShotgunWorkspaceConfig,
  groupShotgunSoldTickets,
  type ShotgunEvent,
} from "../lib/shotgun.js";
import { ExpenseDao } from "../dao/expense.dao.js";

type ExpenseInput = {
  label: string;
  amount: string;
  phase: BudgetPhase;
  amountInputMode: AmountInputMode;
  vatRateBasisPoints: number;
  category: string;
  paidById?: string | null;
  paidAt?: string | null;
  reimbursement: ReimbStatus;
  receiptUrl?: string | null;
  notes?: string | null;
};

type IncomeInput = {
  label: string;
  amount: string;
  phase: BudgetPhase;
  amountInputMode: AmountInputMode;
  vatRateBasisPoints: number;
  category: string;
  receivedAt?: string | null;
};

type TicketTierInput = {
  name: string;
  organizerRevenueCents: number;
  publicPriceCents: number;
  quantity: number;
  sold?: number;
};

type ConsumableInput = {
  name: string;
  unitPriceCents: number;
  estimatedQty: number;
};

type EventTaxSettings = {
  vatMode: VatMode;
};

type ComputedAmounts = {
  amountCents: number;
  amountHtCents: number;
  amountVatCents: number;
  amountTtcCents: number;
};

function computeBudgetAmountsFromCents(
  inputCents: number,
  amountInputMode: AmountInputMode,
  vatRateBasisPoints: number,
  vatMode: VatMode,
): ComputedAmounts {
  const effectiveVatRateBasisPoints = vatMode === "ASSUJETTI" ? vatRateBasisPoints : 0;

  if (amountInputMode === "HT") {
    const amountHtCents = inputCents;
    const amountVatCents = Math.round((amountHtCents * effectiveVatRateBasisPoints) / 10000);
    const amountTtcCents = amountHtCents + amountVatCents;
    return { amountCents: amountTtcCents, amountHtCents, amountVatCents, amountTtcCents };
  }

  const amountTtcCents = inputCents;
  const divisor = 10000 + effectiveVatRateBasisPoints;
  const amountHtCents =
    divisor > 0 ? Math.round((amountTtcCents * 10000) / divisor) : amountTtcCents;
  const amountVatCents = amountTtcCents - amountHtCents;
  return { amountCents: amountTtcCents, amountHtCents, amountVatCents, amountTtcCents };
}

function computeBudgetAmounts(
  rawAmount: string,
  amountInputMode: AmountInputMode,
  vatRateBasisPoints: number,
  vatMode: VatMode,
): ComputedAmounts {
  return computeBudgetAmountsFromCents(parseEuros(rawAmount), amountInputMode, vatRateBasisPoints, vatMode);
}

function shotgunRevenueCents(deal: ShotgunEvent["deals"][number]) {
  return Math.max(0, Math.round(deal.price * 100));
}

function shotgunPublicPriceCents(deal: ShotgunEvent["deals"][number]) {
  const organizerFees = deal.organizer_fees ?? 0;
  const userFees = deal.user_fees ?? 0;
  return Math.max(0, Math.round((deal.price + organizerFees + userFees) * 100));
}

/**
 * Synchronise la dépense participant liée à une expense mise à jour.
 *
 * @param tx - Client Prisma transactionnel
 * @param expense - Expense mise à jour (sourceParticipantId + amountCents)
 */
async function syncParticipantFee(
  tx: Prisma.TransactionClient,
  expense: { sourceParticipantId: string | null; amountCents: number },
) {
  if (!expense.sourceParticipantId) return;
  await tx.eventParticipant.update({
    where: { id: expense.sourceParticipantId },
    data: { fee: expense.amountCents / 100 },
  });
}

/**
 * Efface le cachet du participant lié à une expense supprimée.
 *
 * @param tx - Client Prisma transactionnel
 * @param sourceParticipantId - Identifiant du participant ou `null`
 */
async function clearParticipantFee(
  tx: Prisma.TransactionClient,
  sourceParticipantId: string | null,
) {
  if (!sourceParticipantId) return;
  await tx.eventParticipant.update({
    where: { id: sourceParticipantId },
    data: { fee: null },
  });
}

/**
 * Repository pour le domaine budget.
 * Couvre les dépenses, revenus, tarifs billets, consommables et la synchronisation Shotgun.
 */
export class BudgetRepository {
  constructor(
    private readonly expenseDao: ExpenseDao,
    private readonly prisma: PrismaClient,
  ) {}

  private async assertEventInWorkspace(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");
  }

  private async getEventTaxSettings(eventId: string, workspaceId: string): Promise<EventTaxSettings> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { vatMode: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");
    return event;
  }

  private async assertPersonIfProvided(personId: string | undefined | null, workspaceId: string) {
    if (!personId) return;
    const person = await this.prisma.person.findFirst({
      where: { id: personId, workspaceId },
      select: { id: true },
    });
    if (!person) throw new NotFoundError("Personne introuvable");
  }

  // ── Expenses ────────────────────────────────────────────────────────────────

  /**
   * Retourne les dépenses d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listExpenses(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.expenseDao.findMany(eventId, workspaceId);
  }

  /**
   * Crée une dépense.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async createExpense(eventId: string, workspaceId: string, data: ExpenseInput) {
    const eventSettings = await this.getEventTaxSettings(eventId, workspaceId);
    await this.assertPersonIfProvided(data.paidById, workspaceId);
    const amounts = computeBudgetAmounts(
      data.amount,
      data.amountInputMode,
      data.vatRateBasisPoints,
      eventSettings.vatMode,
    );

    return this.prisma.expense.create({
      data: {
        eventId,
        label: data.label,
        amountCents: amounts.amountCents,
        phase: data.phase,
        amountInputMode: data.amountInputMode,
        vatRateBasisPoints: eventSettings.vatMode === "ASSUJETTI" ? data.vatRateBasisPoints : 0,
        amountHtCents: amounts.amountHtCents,
        amountVatCents: amounts.amountVatCents,
        amountTtcCents: amounts.amountTtcCents,
        category: data.category,
        paidById: data.paidById || null,
        paidAt: data.paidAt ? new Date(data.paidAt) : null,
        reimbursement: data.reimbursement,
        receiptUrl: data.receiptUrl || null,
        notes: data.notes || null,
      },
    });
  }

  /**
   * Met à jour une dépense et synchronise le cachet du participant lié.
   *
   * @param id - Identifiant de la dépense
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données de mise à jour
   * @throws {NotFoundError} Si la dépense est introuvable
   */
  async updateExpense(id: string, workspaceId: string, data: ExpenseInput) {
    const existingExpense = await this.expenseDao.findByIdOrThrow(id, workspaceId);
    await this.assertPersonIfProvided(data.paidById, workspaceId);
    const eventSettings = await this.getEventTaxSettings(existingExpense.eventId, workspaceId);
    const amounts = computeBudgetAmounts(
      data.amount,
      data.amountInputMode,
      data.vatRateBasisPoints,
      eventSettings.vatMode,
    );

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({
        where: { id },
        data: {
          label: data.label,
          amountCents: amounts.amountCents,
          phase: data.phase,
          amountInputMode: data.amountInputMode,
          vatRateBasisPoints: eventSettings.vatMode === "ASSUJETTI" ? data.vatRateBasisPoints : 0,
          amountHtCents: amounts.amountHtCents,
          amountVatCents: amounts.amountVatCents,
          amountTtcCents: amounts.amountTtcCents,
          category: data.category,
          paidById: data.paidById || null,
          paidAt: data.paidAt ? new Date(data.paidAt) : null,
          reimbursement: data.reimbursement,
          receiptUrl: data.receiptUrl || null,
          notes: data.notes || null,
        },
      });
      await syncParticipantFee(tx, expense);
      return expense;
    });
  }

  /**
   * Supprime une dépense et efface le cachet du participant lié.
   *
   * @param id - Identifiant de la dépense
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la dépense est introuvable
   */
  async deleteExpense(id: string, workspaceId: string) {
    await this.expenseDao.findByIdOrThrow(id, workspaceId);

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id, event: { workspaceId } },
      });
      await tx.expense.delete({ where: { id } });
      await clearParticipantFee(tx, expense?.sourceParticipantId ?? null);
      return expense;
    });
  }

  /**
   * Retourne les personnes associées aux participants d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listExpensePersons(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.expenseDao.findPersonsForEvent(eventId, workspaceId);
  }

  // ── Incomes ─────────────────────────────────────────────────────────────────

  /**
   * Retourne les revenus d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listIncomes(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.prisma.income.findMany({
      where: { eventId },
      orderBy: { receivedAt: "desc" },
    });
  }

  /**
   * Crée un revenu.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async createIncome(eventId: string, workspaceId: string, data: IncomeInput) {
    const eventSettings = await this.getEventTaxSettings(eventId, workspaceId);
    const amounts = computeBudgetAmounts(
      data.amount,
      data.amountInputMode,
      data.vatRateBasisPoints,
      eventSettings.vatMode,
    );
    return this.prisma.income.create({
      data: {
        eventId,
        label: data.label,
        amountCents: amounts.amountCents,
        phase: data.phase,
        amountInputMode: data.amountInputMode,
        vatRateBasisPoints: eventSettings.vatMode === "ASSUJETTI" ? data.vatRateBasisPoints : 0,
        amountHtCents: amounts.amountHtCents,
        amountVatCents: amounts.amountVatCents,
        amountTtcCents: amounts.amountTtcCents,
        category: data.category,
        receivedAt: data.receivedAt ? new Date(data.receivedAt) : null,
      },
    });
  }

  /**
   * Met à jour un revenu.
   *
   * @param id - Identifiant du revenu
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données de mise à jour
   * @throws {NotFoundError} Si le revenu est introuvable
   */
  async updateIncome(id: string, workspaceId: string, data: IncomeInput) {
    const existing = await this.prisma.income.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true, eventId: true },
    });
    if (!existing) throw new NotFoundError("Revenu introuvable");
    const eventSettings = await this.getEventTaxSettings(existing.eventId, workspaceId);
    const amounts = computeBudgetAmounts(
      data.amount,
      data.amountInputMode,
      data.vatRateBasisPoints,
      eventSettings.vatMode,
    );

    return this.prisma.income.update({
      where: { id },
      data: {
        label: data.label,
        amountCents: amounts.amountCents,
        phase: data.phase,
        amountInputMode: data.amountInputMode,
        vatRateBasisPoints: eventSettings.vatMode === "ASSUJETTI" ? data.vatRateBasisPoints : 0,
        amountHtCents: amounts.amountHtCents,
        amountVatCents: amounts.amountVatCents,
        amountTtcCents: amounts.amountTtcCents,
        category: data.category,
        receivedAt: data.receivedAt ? new Date(data.receivedAt) : null,
      },
    });
  }

  /**
   * Supprime un revenu.
   *
   * @param id - Identifiant du revenu
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si le revenu est introuvable
   */
  async deleteIncome(id: string, workspaceId: string) {
    const existing = await this.prisma.income.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Revenu introuvable");
    return this.prisma.income.delete({ where: { id } });
  }

  // ── Ticket Tiers ─────────────────────────────────────────────────────────────

  /**
   * Retourne les tarifs billets d'un événement.
   * Tente une synchronisation Shotgun silencieuse avant de retourner.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listTicketTiers(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    try {
      await this.syncShotgunTicketTiers(eventId, workspaceId);
    } catch {
      // Conserve le snapshot local si Shotgun est temporairement indisponible.
    }
    return this.prisma.ticketTier.findMany({
      where: { eventId },
      orderBy: { organizerRevenueCents: "asc" },
    });
  }

  /**
   * Crée un tarif billet manuellement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async createTicketTier(eventId: string, workspaceId: string, data: TicketTierInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.prisma.ticketTier.create({ data: { eventId, ...data } });
  }

  /**
   * Met à jour un tarif billet.
   *
   * @param id - Identifiant du tarif
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données de mise à jour
   * @throws {NotFoundError} Si le tarif est introuvable
   */
  async updateTicketTier(id: string, workspaceId: string, data: TicketTierInput) {
    const existing = await this.prisma.ticketTier.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Tarif billet introuvable");
    return this.prisma.ticketTier.update({ where: { id }, data });
  }

  /**
   * Supprime un tarif billet.
   *
   * @param id - Identifiant du tarif
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si le tarif est introuvable
   */
  async deleteTicketTier(id: string, workspaceId: string) {
    const existing = await this.prisma.ticketTier.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Tarif billet introuvable");
    return this.prisma.ticketTier.delete({ where: { id } });
  }

  /**
   * Synchronise les tarifs billets depuis l'API Shotgun.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {ValidationError} Si l'événement n'est pas lié à Shotgun
   * @throws {NotFoundError} Si l'événement Shotgun correspondant est introuvable
   */
  async syncShotgunTicketTiers(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true, shotgunEventId: true },
    });
    if (!event?.shotgunEventId) {
      throw new ValidationError("Cet evenement n'est pas lie a Shotgun");
    }

    const config = await getShotgunWorkspaceConfig(workspaceId);
    const allEvents = [
      ...(await fetchShotgunEvents(config, {})),
      ...(await fetchShotgunEvents(config, { pastEvents: true })),
    ].filter((e, i, arr) => arr.findIndex((c) => c.id === e.id) === i);

    const shotgunEvent = allEvents.find((e) => e.id === event.shotgunEventId);
    if (!shotgunEvent) throw new NotFoundError("Evenement Shotgun introuvable");

    const soldCounts = groupShotgunSoldTickets(
      await fetchShotgunTickets(config, shotgunEvent.id),
    );
    const remoteDealIds = new Set(shotgunEvent.deals.map((d) => d.product_id));

    await this.prisma.$transaction(async (tx) => {
      for (const deal of shotgunEvent.deals) {
        const sold = soldCounts.get(deal.product_id) ?? 0;
        await tx.ticketTier.upsert({
          where: { shotgunDealId: deal.product_id },
          create: {
            eventId,
            name: deal.name,
            shotgunDealId: deal.product_id,
            organizerRevenueCents: shotgunRevenueCents(deal),
            publicPriceCents: shotgunPublicPriceCents(deal),
            quantity: deal.quantity,
            sold,
            source: "API_SHOTGUN" as TicketSource,
            archivedAt: null,
          },
          update: {
            eventId,
            name: deal.name,
            organizerRevenueCents: shotgunRevenueCents(deal),
            publicPriceCents: shotgunPublicPriceCents(deal),
            quantity: deal.quantity,
            sold,
            source: "API_SHOTGUN" as TicketSource,
            archivedAt: null,
          },
        });
      }

      const removed = await tx.ticketTier.findMany({
        where: {
          eventId,
          source: "API_SHOTGUN" as TicketSource,
          shotgunDealId: { notIn: [...remoteDealIds] },
          archivedAt: null,
        },
        select: { id: true, sold: true },
      });

      for (const tier of removed) {
        if (tier.sold === 0) {
          await tx.ticketTier.delete({ where: { id: tier.id } });
        } else {
          await tx.ticketTier.update({
            where: { id: tier.id },
            data: { archivedAt: new Date() },
          });
        }
      }
    });
  }

  // ── Consumables ──────────────────────────────────────────────────────────────

  /**
   * Retourne les consommables d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listConsumables(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.prisma.consumableItem.findMany({
      where: { eventId },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Crée un consommable.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async createConsumable(eventId: string, workspaceId: string, data: ConsumableInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.prisma.consumableItem.create({
      data: { eventId, name: data.name, unitPriceCents: data.unitPriceCents, estimatedQty: data.estimatedQty },
    });
  }

  /**
   * Met à jour un consommable.
   *
   * @param id - Identifiant du consommable
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données de mise à jour
   * @throws {NotFoundError} Si le consommable est introuvable
   */
  async updateConsumable(id: string, workspaceId: string, data: ConsumableInput) {
    const existing = await this.prisma.consumableItem.findUnique({
      where: { id },
      select: { event: { select: { workspaceId: true } } },
    });
    if (!existing || existing.event.workspaceId !== workspaceId) {
      throw new NotFoundError("Consommable introuvable");
    }
    return this.prisma.consumableItem.update({
      where: { id },
      data: { name: data.name, unitPriceCents: data.unitPriceCents, estimatedQty: data.estimatedQty },
    });
  }

  /**
   * Supprime un consommable.
   *
   * @param id - Identifiant du consommable
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si le consommable est introuvable
   */
  async deleteConsumable(id: string, workspaceId: string) {
    const existing = await this.prisma.consumableItem.findUnique({
      where: { id },
      select: { event: { select: { workspaceId: true } } },
    });
    if (!existing || existing.event.workspaceId !== workspaceId) {
      throw new NotFoundError("Consommable introuvable");
    }
    return this.prisma.consumableItem.delete({ where: { id } });
  }

  // ── Equipment Expenses Sync ──────────────────────────────────────────────────

  /**
   * Resynchronise les dépenses équipement d'un événement.
   * Supprime toutes les dépenses de type équipement existantes et les recrée
   * depuis les devis et usages standalone.
   *
   * @param eventId - Identifiant de l'événement
   */
  async syncEquipmentExpenses(eventId: string) {
    await this.prisma.expense.deleteMany({ where: { eventId, isEquipmentSync: true } });
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { vatMode: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");

    const quotes = await this.prisma.equipmentQuote.findMany({
      where: { eventId },
      include: { usages: true },
    });

    for (const quote of quotes) {
      const subtotal = quote.usages.reduce(
        (s, u) => s + Math.round(u.unitPriceCents * Number(u.rentalCoef)) * u.quantity,
        0,
      );
      if (subtotal === 0) continue;

      const discountAmt =
        quote.discountCents != null
          ? quote.discountCents
          : quote.discountPct != null
            ? Math.round((subtotal * Number(quote.discountPct)) / 100)
            : 0;
      const net = Math.max(0, subtotal - discountAmt);
      if (net === 0) continue;
      const amounts = computeBudgetAmountsFromCents(
        net,
        quote.amountInputMode,
        quote.vatRateBasisPoints,
        event.vatMode,
      );

      await this.prisma.expense.create({
        data: {
          eventId,
          label: quote.label,
          amountCents: amounts.amountCents,
          amountInputMode: quote.amountInputMode,
          vatRateBasisPoints: event.vatMode === "ASSUJETTI" ? quote.vatRateBasisPoints : 0,
          amountHtCents: amounts.amountHtCents,
          amountVatCents: amounts.amountVatCents,
          amountTtcCents: amounts.amountTtcCents,
          category: "matériel",
          reimbursement: "NOT_OWED",
          isEquipmentSync: true,
          equipmentQuoteId: quote.id,
          receiptUrl: quote.fileUrl ?? null,
        },
      });
    }

    const standaloneUsages = await this.prisma.equipmentUsage.findMany({
      where: { eventId, quoteId: null },
      include: { item: { select: { name: true } } },
    });

    for (const usage of standaloneUsages) {
      const amount =
        Math.round(usage.unitPriceCents * Number(usage.rentalCoef)) * usage.quantity;
      if (amount === 0) continue;
      const amounts = computeBudgetAmountsFromCents(
        amount,
        usage.amountInputMode,
        usage.vatRateBasisPoints,
        event.vatMode,
      );

      const label = usage.name ?? usage.item?.name ?? "Matériel";
      await this.prisma.expense.create({
        data: {
          eventId,
          label,
          amountCents: amounts.amountCents,
          amountInputMode: usage.amountInputMode,
          vatRateBasisPoints: event.vatMode === "ASSUJETTI" ? usage.vatRateBasisPoints : 0,
          amountHtCents: amounts.amountHtCents,
          amountVatCents: amounts.amountVatCents,
          amountTtcCents: amounts.amountTtcCents,
          category: "matériel",
          reimbursement: "NOT_OWED",
          isEquipmentSync: true,
        },
      });
    }
  }
}
