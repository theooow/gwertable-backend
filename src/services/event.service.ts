import type { UsagePlan, UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import { resolveEventStatus } from "../lib/event-status.js";
import { activeEventLimit, activeEventStatuses, requireActiveEventSlot } from "../lib/usage-plans.js";
import type { EventInput } from "../schemas/event.js";
import { EventRepository, type CollaboratorContext } from "../repositories/event.repository.js";

/**
 * Service métier pour le domaine événement.
 * Applique les contrôles de permissions avant de déléguer au {@link EventRepository}.
 */
export class EventService {
  constructor(
    private readonly eventRepository: EventRepository,
    private readonly onEventClosed?: (userId: string) => Promise<void>,
  ) {}

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
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture ou si le plan n'a plus d'événement en cours disponible
   * @throws {NotFoundError} Si le lieu spécifié est introuvable
   */
  async create(workspaceId: string, role: UserRole, userId: string, usagePlan: UsagePlan, input: EventInput) {
    requireCan(role, "event.write");
    const data = { ...input, status: resolveEventStatus({ ...input, status: "PLANNING" }) };
    if (activeEventStatuses.includes(data.status)) await this.requireActiveEventSlot(userId, usagePlan);
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
  async update(id: string, workspaceId: string, role: UserRole, userId: string, usagePlan: UsagePlan, input: EventInput) {
    requireCan(role, "event.write");
    const data = { ...input, status: resolveEventStatus(input) };
    const previousStatus = await this.eventRepository.findEventStatus(id, workspaceId);
    if (activeEventLimit(usagePlan) !== null && activeEventStatuses.includes(data.status) && !activeEventStatuses.includes(previousStatus)) {
      await this.requireActiveEventSlot(userId, usagePlan);
    }
    const event = await this.eventRepository.updateEvent(id, workspaceId, userId, data);
    if (data.status === "DONE" && previousStatus !== "DONE") await this.onEventClosed?.(userId);
    return event;
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

  private async requireActiveEventSlot(userId: string, usagePlan: UsagePlan) {
    if (activeEventLimit(usagePlan) === null) return;
    requireActiveEventSlot(usagePlan, await this.eventRepository.countActiveEventsAdministeredBy(userId));
  }
}
