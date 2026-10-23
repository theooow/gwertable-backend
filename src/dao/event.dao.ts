import type { PrismaClient } from "@prisma/client";
import { EventStatus, TicketSource } from "@prisma/client";
import type { EventInput } from "../schemas/event.js";
import { activeEventStatuses } from "../lib/usage-plans.js";
import { EVENT_DEFAULT_DURATION_MS } from "../lib/event-status.js";
import { BaseDao } from "./base.dao.js";

const listInclude = {
  venue: { select: { fullName: true, address: true } },
  _count: { select: { participants: true, tasks: true, expenses: true, runOfShow: true } },
  expenses: { select: { amountCents: true } },
  incomes: { select: { amountCents: true } },
  ticketTiers: {
    select: {
      organizerRevenueCents: true,
      quantity: true,
      sold: true,
      excludeFromBreakEven: true,
      archivedAt: true,
    },
  },
} as const;

const detailInclude = {
  venue: true,
  _count: {
    select: {
      participants: true,
      tasks: true,
      expenses: true,
      shopping: true,
      shifts: true,
      runOfShow: true,
    },
  },
} as const;

/**
 * DAO pour le modèle {@link Event}.
 * Fournit les opérations CRUD et la gestion des collaborateurs d'événement.
 */
export class EventDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Retourne tous les événements d'un espace de travail, triés par date décroissante.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findAll(workspaceId: string) {
    return this.prisma.event.findMany({
      where: { workspaceId },
      include: listInclude,
      orderBy: { startsAt: "desc" },
    });
  }

  /**
   * Retourne les événements d'un espace de travail filtrés par une liste d'identifiants.
   * Utilisé pour les utilisateurs en mode collaborateur (eventScoped).
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param ids - Liste des identifiants d'événements autorisés
   */
  async findByIds(workspaceId: string, ids: string[]) {
    return this.prisma.event.findMany({
      where: { workspaceId, id: { in: ids } },
      include: listInclude,
      orderBy: { startsAt: "desc" },
    });
  }

  /**
   * Retourne les identifiants des événements accessibles à un collaborateur.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param userId - Identifiant de l'utilisateur
   * @param userEmail - Email de l'utilisateur
   * @returns Liste des identifiants d'événements
   */
  async findCollaboratorEventIds(
    workspaceId: string,
    userId: string,
    userEmail: string,
  ): Promise<string[]> {
    const entries = await this.prisma.eventCollaborator.findMany({
      where: {
        workspaceId,
        acceptedAt: { not: null },
        OR: [{ userId }, { email: userEmail }],
      },
      select: { eventId: true },
    });
    return entries.map((e) => e.eventId);
  }

  /**
   * Vérifie qu'un collaborateur a accès à un événement spécifique.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param userId - Identifiant de l'utilisateur
   * @param userEmail - Email de l'utilisateur
   * @returns `true` si l'accès est autorisé, `false` sinon
   */
  async hasCollaboratorAccess(
    eventId: string,
    workspaceId: string,
    userId: string,
    userEmail: string,
  ): Promise<boolean> {
    const entry = await this.prisma.eventCollaborator.findFirst({
      where: {
        eventId,
        workspaceId,
        acceptedAt: { not: null },
        OR: [{ userId }, { email: userEmail }],
      },
      select: { id: true },
    });
    return entry !== null;
  }

  /**
   * Retourne un événement par son identifiant avec ses détails complets.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns L'événement ou `null` s'il n'existe pas
   */
  async findById(id: string, workspaceId: string) {
    return this.prisma.event.findUnique({
      where: { id, workspaceId },
      include: detailInclude,
    });
  }

  /**
   * Retourne uniquement l'identifiant Shotgun d'un événement.
   * Utilisé lors de la mise à jour pour détecter un changement d'intégration Shotgun.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  /** Events still in progress across every workspace the user administers, which is what plan limits count. */
  async countActiveAdministeredBy(userId: string) {
    return this.prisma.event.count({
      where: { status: { in: activeEventStatuses }, workspace: { members: { some: { userId, role: "ADMIN" } } } },
    });
  }

  async findStatus(id: string, workspaceId: string) {
    return this.prisma.event.findUnique({ where: { id, workspaceId }, select: { status: true } });
  }

  async findShotgunId(id: string, workspaceId: string) {
    return this.prisma.event.findUnique({
      where: { id, workspaceId },
      select: { shotgunEventId: true },
    });
  }

  /**
   * Fait suivre aux événements non archivés le statut donné par leurs dates :
   * à venir (`PLANNING`), en cours (`LIVE`) puis terminé (`DONE`).
   * Sans date de fin, un événement est considéré terminé 24 h après son début.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param now - Date de référence
   */
  async syncDateStatuses(workspaceId: string, now: Date = new Date()) {
    const ended = [
      { endsAt: { lte: now } },
      { endsAt: null, startsAt: { lte: new Date(now.getTime() - EVENT_DEFAULT_DURATION_MS) } },
    ];
    await this.prisma.$transaction([
      this.prisma.event.updateMany({
        where: { workspaceId, status: { in: [EventStatus.DRAFT, EventStatus.PLANNING, EventStatus.LIVE] }, OR: ended },
        data: { status: EventStatus.DONE },
      }),
      this.prisma.event.updateMany({
        where: { workspaceId, status: { in: [EventStatus.DRAFT, EventStatus.PLANNING, EventStatus.DONE] }, startsAt: { lte: now }, NOT: { OR: ended } },
        data: { status: EventStatus.LIVE },
      }),
      this.prisma.event.updateMany({
        where: { workspaceId, status: { in: [EventStatus.DRAFT, EventStatus.LIVE, EventStatus.DONE] }, startsAt: { gt: now } },
        data: { status: EventStatus.PLANNING },
      }),
    ]);
  }

  /**
   * Crée un nouvel événement.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de l'événement
   * @returns L'événement créé
   */
  async create(workspaceId: string, data: EventInput) {
    return this.prisma.event.create({
      data: {
        workspaceId,
        name: data.name,
        shotgunEventId: data.shotgunEventId ?? null,
        startsAt: new Date(data.startsAt),
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        status: data.status,
        description: data.description || null,
        bannerUrl: data.bannerUrl || null,
        genres: [...new Set(data.genres ?? [])],
        venueId: data.venueId || null,
        nbCollectifs: data.nbCollectifs,
        kegUnitPriceCents: data.kegUnitPriceCents,
        avgBasketCents: data.avgBasketCents,
        vatMode: data.vatMode,
        defaultVatRateBasisPoints: data.defaultVatRateBasisPoints,
        sacemEnabled: data.sacemEnabled,
        sacemRateBasisPoints: data.sacemRateBasisPoints,
        sacemBase: data.sacemBase,
      },
    });
  }

  /**
   * Met à jour un événement existant.
   *
   * @param id - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @returns L'événement mis à jour
   */
  async update(id: string, workspaceId: string, data: EventInput) {
    return this.prisma.event.update({
      where: { id, workspaceId },
      data: {
        name: data.name,
        shotgunEventId: data.shotgunEventId ?? null,
        startsAt: new Date(data.startsAt),
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        status: data.status,
        description: data.description || null,
        bannerUrl: data.bannerUrl || null,
        ...(data.genres ? { genres: [...new Set(data.genres)] } : {}),
        venueId: data.venueId || null,
        nbCollectifs: data.nbCollectifs,
        kegUnitPriceCents: data.kegUnitPriceCents,
        avgBasketCents: data.avgBasketCents,
        vatMode: data.vatMode,
        defaultVatRateBasisPoints: data.defaultVatRateBasisPoints,
        sacemEnabled: data.sacemEnabled,
        sacemRateBasisPoints: data.sacemRateBasisPoints,
        sacemBase: data.sacemBase,
      },
    });
  }

  /**
   * Supprime les tarifs Shotgun liés à un événement.
   * Appelé lorsque l'identifiant Shotgun change lors d'une mise à jour.
   *
   * @param eventId - Identifiant de l'événement
   */
  async deleteShotgunTicketTiers(eventId: string) {
    return this.prisma.ticketTier.deleteMany({
      where: { eventId, source: TicketSource.API_SHOTGUN },
    });
  }

  /**
   * Supprime un événement et toutes ses données associées.
   *
   * @param id - Identifiant de l'événement
   * @returns L'événement supprimé
   */
  async delete(id: string) {
    return this.prisma.event.delete({ where: { id } });
  }
}
