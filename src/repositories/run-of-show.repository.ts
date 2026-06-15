import type { PrismaClient, Prisma } from "@prisma/client";
import { NotFoundError } from "../lib/errors.js";
import { RunOfShowDao } from "../dao/run-of-show.dao.js";

type RunOfShowInput = {
  trackId?: string | null;
  startsAt: string;
  durationMin: number;
  title: string;
  responsible?: string | null;
  responsiblePersonId?: string | null;
  notes?: string | null;
};

type RunOfShowTrackInput = {
  name: string;
  color?: string | null;
};

/**
 * Synchronise la tâche source liée à un élément du conducteur dans une transaction.
 *
 * @param tx - Client Prisma transactionnel
 * @param item - Données de l'élément après mise à jour
 */
async function syncTaskForRunOfShowItem(
  tx: Prisma.TransactionClient,
  item: {
    sourceTaskId: string | null;
    title: string;
    startsAt: Date;
    responsiblePersonId: string | null;
    notes: string | null;
  },
) {
  if (!item.sourceTaskId) return null;
  return tx.task.update({
    where: { id: item.sourceTaskId },
    data: {
      title: item.title,
      description: item.notes,
      dueAt: item.startsAt,
      assigneeId: item.responsiblePersonId,
    },
  });
}

/**
 * Repository pour le domaine conducteur de show (run-of-show).
 * Orchestre le CRUD et la synchronisation avec les tâches liées.
 */
export class RunOfShowRepository {
  constructor(
    private readonly runOfShowDao: RunOfShowDao,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Vérifie qu'un événement appartient à l'espace de travail.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async assertEventInWorkspace(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");
  }

  /**
   * Vérifie qu'une personne est participante de l'événement (si fournie).
   * Utilisé pour valider le champ `responsiblePersonId`.
   *
   * @param personId - Identifiant optionnel de la personne
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la personne n'est pas participante
   */
  async assertParticipantPersonIfProvided(
    personId: string | undefined | null,
    eventId: string,
    workspaceId: string,
  ) {
    if (!personId) return;
    const participant = await this.prisma.eventParticipant.findFirst({
      where: { eventId, personId, event: { workspaceId }, person: { workspaceId } },
      select: { id: true },
    });
    if (!participant) throw new NotFoundError("Participant introuvable pour cet evenement");
  }

  async assertTrackIfProvided(
    trackId: string | undefined | null,
    eventId: string,
    workspaceId: string,
  ) {
    if (!trackId) return;
    const track = await this.prisma.runOfShowTrack.findFirst({
      where: { id: trackId, eventId, event: { workspaceId } },
      select: { id: true },
    });
    if (!track) throw new NotFoundError("Metier de conducteur introuvable pour cet evenement");
  }

  /**
   * Retourne les éléments du conducteur d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listItems(eventId: string, workspaceId: string) {
    return this.runOfShowDao.findMany(eventId, workspaceId);
  }

  async listTracks(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.prisma.runOfShowTrack.findMany({
      where: { eventId, event: { workspaceId } },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { _count: { select: { items: true } } },
    });
  }

  async createTrack(eventId: string, workspaceId: string, data: RunOfShowTrackInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const lastTrack = await this.prisma.runOfShowTrack.findFirst({
      where: { eventId, event: { workspaceId } },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return this.prisma.runOfShowTrack.create({
      data: {
        eventId,
        name: data.name,
        color: data.color || null,
        position: (lastTrack?.position ?? -1) + 1,
      },
      include: { _count: { select: { items: true } } },
    });
  }

  async updateTrack(id: string, workspaceId: string, data: RunOfShowTrackInput) {
    const track = await this.prisma.runOfShowTrack.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true },
    });
    if (!track) throw new NotFoundError("Metier de conducteur introuvable");
    return this.prisma.runOfShowTrack.update({
      where: { id },
      data: { name: data.name, color: data.color || null },
      include: { _count: { select: { items: true } } },
    });
  }

  async deleteTrack(id: string, workspaceId: string) {
    const track = await this.prisma.runOfShowTrack.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true },
    });
    if (!track) throw new NotFoundError("Metier de conducteur introuvable");
    return this.prisma.runOfShowTrack.delete({ where: { id } });
  }

  /**
   * Crée un élément du conducteur.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async create(eventId: string, workspaceId: string, data: RunOfShowInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    await this.assertParticipantPersonIfProvided(
      data.responsiblePersonId,
      eventId,
      workspaceId,
    );
    await this.assertTrackIfProvided(data.trackId, eventId, workspaceId);

    return this.runOfShowDao.create(eventId, {
      trackId: data.trackId || null,
      startsAt: new Date(data.startsAt),
      durationMin: data.durationMin,
      title: data.title,
      responsible: data.responsible || null,
      responsiblePersonId: data.responsiblePersonId || null,
      notes: data.notes || null,
    });
  }

  /**
   * Met à jour un élément du conducteur et synchronise la tâche liée.
   *
   * @param id - Identifiant de l'élément
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @param eventId - Identifiant optionnel de l'événement (pour validation supplémentaire)
   * @throws {NotFoundError} Si l'élément est introuvable
   */
  async update(id: string, workspaceId: string, data: RunOfShowInput, eventId?: string) {
    const existing = await this.runOfShowDao.findByIdOrThrow(id, workspaceId, eventId);
    await this.assertParticipantPersonIfProvided(
      data.responsiblePersonId,
      existing.eventId,
      workspaceId,
    );
    await this.assertTrackIfProvided(data.trackId, existing.eventId, workspaceId);

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.runOfShowItem.update({
        where: { id },
        data: {
          trackId: data.trackId || null,
          startsAt: new Date(data.startsAt),
          durationMin: data.durationMin,
          title: data.title,
          responsible: data.responsible || null,
          responsiblePersonId: data.responsiblePersonId || null,
          notes: data.notes || null,
        },
        include: {
          track: { select: { id: true, name: true, color: true, position: true } },
          responsiblePerson: { select: { id: true, fullName: true } },
          sourceTask: { select: { id: true, title: true } },
        },
      });
      await syncTaskForRunOfShowItem(tx, item);
      return item;
    });
  }

  /**
   * Supprime un élément du conducteur et la tâche source si liée.
   *
   * @param id - Identifiant de l'élément
   * @param workspaceId - Identifiant de l'espace de travail
   * @param eventId - Identifiant optionnel de l'événement
   * @throws {NotFoundError} Si l'élément est introuvable
   */
  async delete(id: string, workspaceId: string, eventId?: string) {
    const item = await this.runOfShowDao.findByIdOrThrow(id, workspaceId, eventId);
    return this.prisma.$transaction(async (tx) => {
      await tx.runOfShowItem.delete({ where: { id } });
      if (item.sourceTaskId) await tx.task.delete({ where: { id: item.sourceTaskId } });
      return item;
    });
  }
}
