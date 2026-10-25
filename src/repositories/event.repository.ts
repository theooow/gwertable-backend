import type { EventInput } from "../schemas/event.js";
import { NotFoundError } from "../lib/errors.js";
import { EventDao } from "../dao/event.dao.js";
import { PersonDao } from "../dao/person.dao.js";
import { ActivityRepository } from "./activity.repository.js";

type EventListRow = Awaited<ReturnType<EventDao["findAll"]>>[number];

/**
 * Mirrors the budget page forecast for tickets sold so far, without the bar estimate
 * from the average basket: planned shopping and the SACEM estimate are counted.
 */
function getBudgetSummary(event: EventListRow) {
  const sacemExpenses = event.expenses.filter((expense) => /sacem/i.test(`${expense.category} ${expense.label}`));
  const sacemLinesCents = sacemExpenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const plannedShoppingCents = event.shopping.reduce((sum, item) => sum + (item.estimatedCents ?? 0), 0);
  const totalOtherIncomeCents = event.incomes.reduce((sum, income) => sum + income.amountCents, 0);
  const ticketRevenueCents = event.ticketTiers.reduce(
    (sum, tier) => sum + tier.sold * tier.organizerRevenueCents,
    0,
  );
  const sacemBaseCents = event.sacemBase === "TOTAL_REVENUE" ? ticketRevenueCents + totalOtherIncomeCents : ticketRevenueCents;
  const sacemEstimateCents = event.sacemEnabled ? Math.round((sacemBaseCents * event.sacemRateBasisPoints) / 10000) : 0;
  const totalExpensesCents = event.expenses.reduce((sum, expense) => sum + expense.amountCents, 0)
    + plannedShoppingCents
    - sacemLinesCents
    + Math.max(sacemLinesCents, sacemEstimateCents);
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
  const { expenses, incomes, ticketTiers, shopping, ...rest } = event;
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
 * Orchestre l'accès aux données via {@link EventDao} et {@link PersonDao}.
 */
export class EventRepository {
  private readonly activityRepository: ActivityRepository;

  constructor(
    private readonly eventDao: EventDao,
    private readonly personDao: PersonDao,
    activityRepository: ActivityRepository,
  ) {
    this.activityRepository = activityRepository;
  }

  /**
   * Retourne la liste des événements de l'espace de travail.
   * En mode collaborateur (`eventScoped`), filtre sur les événements accessibles.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param collaborator - Contexte collaborateur si l'utilisateur est en mode `eventScoped`
   */
  async listEvents(workspaceId: string, collaborator?: CollaboratorContext) {
    await this.eventDao.syncDateStatuses(workspaceId);
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

    await this.eventDao.syncDateStatuses(workspaceId);
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
  countActiveEventsAdministeredBy(userId: string) {
    return this.eventDao.countActiveAdministeredBy(userId);
  }

  async findEventStatus(id: string, workspaceId: string) {
    const event = await this.eventDao.findStatus(id, workspaceId);
    if (!event) throw new NotFoundError("Evenement introuvable");
    return event.status;
  }

  async createEvent(workspaceId: string, userId: string, data: EventInput) {
    if (data.venueId) {
      await this.personDao.findByIdOrThrow(data.venueId, workspaceId);
    }
    const event = await this.eventDao.create(workspaceId, data);
    await this.activityRepository.record({
      workspaceId,
      eventId: event.id,
      actorId: userId,
      type: "EVENT_CREATED",
      title: `Événement créé : ${event.name}`,
      entityType: "EVENT",
      entityId: event.id,
      notify: false,
    });
    return event;
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
  async updateEvent(id: string, workspaceId: string, userId: string, data: EventInput) {
    const current = await this.eventDao.findShotgunId(id, workspaceId);
    if (!current) throw new NotFoundError("Evenement introuvable");

    if (data.venueId) {
      await this.personDao.findByIdOrThrow(data.venueId, workspaceId);
    }

    const updated = await this.eventDao.update(id, workspaceId, data);

    if (current.shotgunEventId && current.shotgunEventId !== data.shotgunEventId) {
      await this.eventDao.deleteShotgunTicketTiers(id);
    }

    await this.activityRepository.record({
      workspaceId,
      eventId: updated.id,
      actorId: userId,
      type: "EVENT_UPDATED",
      title: `Événement modifié : ${updated.name}`,
      entityType: "EVENT",
      entityId: updated.id,
      notify: false,
    });
    return updated;
  }

  /**
   * Supprime un événement après vérification de son existence.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async deleteEvent(id: string, workspaceId: string, userId: string) {
    const event = await this.eventDao.findById(id, workspaceId);
    if (!event) throw new NotFoundError("Evenement introuvable");
    const deleted = await this.eventDao.delete(id);
    await this.activityRepository.record({
      workspaceId,
      eventId: null,
      actorId: userId,
      type: "EVENT_DELETED",
      title: `Événement supprimé : ${deleted.name}`,
      entityType: "EVENT",
      entityId: deleted.id,
      notify: false,
    });
    return deleted;
  }
}
