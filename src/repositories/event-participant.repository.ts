import type { PrismaClient, Prisma } from "@prisma/client";
import type { ParticipantInput } from "../schemas/participant.js";
import { NotFoundError, ConflictError } from "../lib/errors.js";
import { EventParticipantDao } from "../dao/event-participant.dao.js";

/**
 * Calcule le montant de cachet normalisé pour un participant.
 * Retourne `null` si le participant n'a pas le rôle ARTIST ou si la valeur est vide.
 *
 * @param fee - Valeur de cachet saisie
 * @param roles - Rôles du participant
 */
function normalizeFee(fee: string | null | undefined, roles: string[]): number | null {
  if (!roles.includes("ARTIST")) return null;
  if (fee === null || fee === undefined || fee.trim() === "") return null;
  return parseFloat(fee);
}

/**
 * Synchronise la dépense de cachet artiste liée à un participant.
 * Crée, met à jour ou supprime la dépense selon le montant du cachet.
 *
 * @param tx - Client Prisma transactionnel
 * @param participant - Données du participant après création/mise à jour
 */
async function syncArtistExpense(
  tx: Prisma.TransactionClient,
  participant: {
    id: string;
    eventId: string;
    personId: string;
    roles: string[];
    fee: { toString(): string } | null;
  },
) {
  const feeValue = participant.fee?.toString() ?? null;
  const amountCents = normalizeFee(feeValue, participant.roles);

  if (amountCents === null) {
    const existing = await tx.expense.findUnique({
      where: { sourceParticipantId: participant.id },
      select: { id: true },
    });
    if (existing) await tx.expense.delete({ where: { id: existing.id } });
    return;
  }

  const person = await tx.person.findUnique({
    where: { id: participant.personId },
    select: { fullName: true },
  });
  const label = `Cachet ${person?.fullName ?? "participant"}`;

  await tx.expense.upsert({
    where: { sourceParticipantId: participant.id },
    create: {
      eventId: participant.eventId,
      sourceParticipantId: participant.id,
      label,
      amountCents: Math.round(amountCents * 100),
      category: "artistes",
      reimbursement: "PENDING",
    },
    update: {
      eventId: participant.eventId,
      label,
      amountCents: Math.round(amountCents * 100),
      category: "artistes",
    },
  });
}

/**
 * Repository pour le domaine participant d'événement.
 * Orchestre le CRUD et la synchronisation de la dépense artiste.
 */
export class EventParticipantRepository {
  constructor(
    private readonly participantDao: EventParticipantDao,
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
   * Vérifie qu'une personne appartient à l'espace de travail.
   *
   * @param personId - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async assertPersonInWorkspace(personId: string, workspaceId: string) {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, workspaceId },
      select: { id: true },
    });
    if (!person) throw new NotFoundError("Personne introuvable");
  }

  /**
   * Retourne la liste des participants d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listParticipants(eventId: string, workspaceId: string) {
    return this.participantDao.findMany(eventId, workspaceId);
  }

  /**
   * Crée un participant et synchronise la dépense artiste dans une transaction.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   * @throws {ConflictError} Si la personne est déjà participante
   */
  async create(eventId: string, workspaceId: string, data: ParticipantInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    await this.assertPersonInWorkspace(data.personId, workspaceId);

    const existing = await this.participantDao.findByEventAndPerson(
      eventId,
      data.personId,
      workspaceId,
    );
    if (existing) throw new ConflictError("Cette personne est deja participante de cet evenement");

    const fee = normalizeFee(data.fee, data.roles);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.eventParticipant.create({
        data: {
          eventId,
          personId: data.personId,
          roles: data.roles,
          rsvpStatus: data.rsvpStatus,
          plusOnes: data.plusOnes,
          dietary: data.dietary || null,
          setStart: data.setStart ? new Date(data.setStart) : null,
          setEnd: data.setEnd ? new Date(data.setEnd) : null,
          fee,
          contractSigned: data.contractSigned,
          internalNotes: data.internalNotes || null,
        },
        include: { person: { select: { id: true, fullName: true } } },
      });
      await syncArtistExpense(tx, created);
      return created;
    });
  }

  /**
   * Met à jour un participant et synchronise la dépense artiste.
   *
   * @param id - Identifiant du participant
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @throws {NotFoundError} Si le participant est introuvable
   */
  async update(id: string, workspaceId: string, data: ParticipantInput) {
    await this.participantDao.findByIdOrThrow(id, workspaceId);
    await this.assertPersonInWorkspace(data.personId, workspaceId);

    const fee = normalizeFee(data.fee, data.roles);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.eventParticipant.update({
        where: { id },
        data: {
          roles: data.roles,
          rsvpStatus: data.rsvpStatus,
          plusOnes: data.plusOnes,
          dietary: data.dietary || null,
          setStart: data.setStart ? new Date(data.setStart) : null,
          setEnd: data.setEnd ? new Date(data.setEnd) : null,
          fee,
          contractSigned: data.contractSigned,
          internalNotes: data.internalNotes || null,
        },
        include: { person: { select: { id: true, fullName: true } } },
      });
      await syncArtistExpense(tx, updated);
      return updated;
    });
  }

  /**
   * Supprime un participant.
   *
   * @param id - Identifiant du participant
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si le participant est introuvable
   */
  async delete(id: string, workspaceId: string) {
    await this.participantDao.findByIdOrThrow(id, workspaceId);
    return this.participantDao.delete(id);
  }

  /**
   * Retourne les personnes participant à un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listPersons(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.participantDao.findPersonsByEvent(eventId, workspaceId);
  }
}
