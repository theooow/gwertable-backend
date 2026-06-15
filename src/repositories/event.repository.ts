import type { EventInput } from "../schemas/event.js";
import { NotFoundError } from "../lib/errors.js";
import { EventDao } from "../dao/event.dao.js";
import { VenueDao } from "../dao/venue.dao.js";

type EventListRow = Awaited<ReturnType<EventDao["findAll"]>>[number];

function getBudgetSummary(event: EventListRow) {
  const totalExpensesCents = event.expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const totalOtherIncomeCents = event.incomes.reduce((sum, income) => sum + income.amountCents, 0);
  const ticketRevenueCents = event.ticketTiers.reduce(
    (sum, tier) => sum + tier.sold * tier.organizerRevenueCents,
    0,
  );
  const activeTiers = event.ticketTiers.filter((tier) => !tier.archivedAt);
  const ticketsSold = event.ticketTiers.reduce((sum, tier) => sum + tier.sold, 0);
  const ticketsCapacity = activeTiers.reduce((sum, tier) => sum + tier.quantity, 0);
  const remainingIncludedPotentialCents = activeTiers.reduce((sum, tier) => {
    if (tier.excludeFromBreakEven) return sum;
    return sum + Math.max(0, tier.quantity - tier.sold) * tier.organizerRevenueCents;
  }, 0);
  const resultCents = totalOtherIncomeCents + ticketRevenueCents - totalExpensesCents;
  const remainingToBreakEvenCents = Math.max(0, -resultCents);
  const breakEvenStatus =
    remainingToBreakEvenCents === 0
      ? "BALANCED"
      : remainingIncludedPotentialCents >= remainingToBreakEvenCents
        ? "REACHABLE"
        : "AT_RISK";

  return {
    totalExpensesCents,
    totalOtherIncomeCents,
    ticketRevenueCents,
    totalRevenueCents: totalOtherIncomeCents + ticketRevenueCents,
    resultCents,
    ticketsSold,
    ticketsCapacity,
    remainingToBreakEvenCents,
    breakEvenStatus,
  };
}

function withBudgetSummary(event: EventListRow) {
  const { expenses, incomes, ticketTiers, ...rest } = event;
  return {
    ...rest,
    budgetSummary: getBudgetSummary(event),
  };
}

/**
 * Contexte d'accès d'un utilisateur en mode collaborateur d'événement.
 */
export type CollaboratorContext = {
  userId: string;
  userEmail: string;
};

/**
 * Repository pour le domaine événement.
 * Orchestre l'accès aux données via {@link EventDao} et {@link VenueDao}.
 */
export class EventRepository {
  constructor(
    private readonly eventDao: EventDao,
    private readonly venueDao: VenueDao,
  ) {}

  /**
   * Retourne la liste des événements de l'espace de travail.
   * En mode collaborateur (`eventScoped`), filtre sur les événements accessibles.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param collaborator - Contexte collaborateur si l'utilisateur est en mode `eventScoped`
   */
  async listEvents(workspaceId: string, collaborator?: CollaboratorContext) {
    if (collaborator) {
      const ids = await this.eventDao.findCollaboratorEventIds(
        workspaceId,
        collaborator.userId,
        collaborator.userEmail,
      );
      const events = await this.eventDao.findByIds(workspaceId, ids);
      return events.map(withBudgetSummary);
    }
    const events = await this.eventDao.findAll(workspaceId);
    return events.map(withBudgetSummary);
  }

  /**
   * Retourne un événement ou lève une {@link NotFoundError}.
   * En mode collaborateur (`eventScoped`), vérifie l'accès à cet événement.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param collaborator - Contexte collaborateur si l'utilisateur est en mode `eventScoped`
   * @throws {NotFoundError} Si l'événement est introuvable ou inaccessible
   */
  async getEventOrThrow(id: string, workspaceId: string, collaborator?: CollaboratorContext) {
    if (collaborator) {
      const hasAccess = await this.eventDao.hasCollaboratorAccess(
        id,
        workspaceId,
        collaborator.userId,
        collaborator.userEmail,
      );
      if (!hasAccess) throw new NotFoundError("Evenement introuvable");
    }

    const event = await this.eventDao.findById(id, workspaceId);
    if (!event) throw new NotFoundError("Evenement introuvable");
    return event;
  }

  /**
   * Crée un événement après validation optionnelle du lieu.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de l'événement
   * @throws {NotFoundError} Si le lieu spécifié est introuvable
   */
  async createEvent(workspaceId: string, data: EventInput) {
    if (data.venueId) {
      await this.venueDao.findByIdOrThrow(data.venueId, workspaceId);
    }
    return this.eventDao.create(workspaceId, data);
  }

  /**
   * Met à jour un événement. Si l'identifiant Shotgun change, supprime les tarifs
   * Shotgun existants pour éviter les données orphelines.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @throws {NotFoundError} Si l'événement ou le lieu est introuvable
   */
  async updateEvent(id: string, workspaceId: string, data: EventInput) {
    const current = await this.eventDao.findShotgunId(id, workspaceId);
    if (!current) throw new NotFoundError("Evenement introuvable");

    if (data.venueId) {
      await this.venueDao.findByIdOrThrow(data.venueId, workspaceId);
    }

    const updated = await this.eventDao.update(id, workspaceId, data);

    if (current.shotgunEventId && current.shotgunEventId !== data.shotgunEventId) {
      await this.eventDao.deleteShotgunTicketTiers(id);
    }

    return updated;
  }

  /**
   * Supprime un événement après vérification de son existence.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async deleteEvent(id: string, workspaceId: string) {
    const event = await this.eventDao.findById(id, workspaceId);
    if (!event) throw new NotFoundError("Evenement introuvable");
    return this.eventDao.delete(id);
  }

  /**
   * Retourne tous les lieux actifs d'un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listVenues(workspaceId: string) {
    return this.venueDao.findAllActive(workspaceId);
  }

  /**
   * Crée un nouveau lieu dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param name - Nom du lieu
   */
  async createVenue(workspaceId: string, name: string) {
    return this.venueDao.create(workspaceId, name);
  }
}
