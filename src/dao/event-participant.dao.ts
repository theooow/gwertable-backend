import type { PrismaClient } from "@prisma/client";
import type { ParticipantInput } from "../schemas/participant.js";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

const personSelect = { id: true, fullName: true, email: true } as const;
const personSelectShort = { id: true, fullName: true } as const;

/**
 * DAO pour le modèle {@link EventParticipant}.
 * Fournit les opérations CRUD sur les participants d'un événement.
 */
export class EventParticipantDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Retourne tous les participants d'un événement avec les informations de la personne.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findMany(eventId: string, workspaceId: string) {
    return this.prisma.eventParticipant.findMany({
      where: { eventId, event: { workspaceId } },
      include: { person: { select: personSelect } },
      orderBy: { person: { fullName: "asc" } },
    });
  }

  /**
   * Recherche un participant par son identifiant dans un espace de travail.
   *
   * @param id - Identifiant du participant
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns Le participant ou `null` s'il est absent
   */
  async findByIdInWorkspace(id: string, workspaceId: string) {
    return this.prisma.eventParticipant.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true },
    });
  }

  /**
   * Recherche un participant ou lève une erreur.
   *
   * @param id - Identifiant du participant
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si le participant est introuvable
   */
  async findByIdOrThrow(id: string, workspaceId: string) {
    const p = await this.findByIdInWorkspace(id, workspaceId);
    if (!p) throw new NotFoundError("Participant introuvable");
    return p;
  }

  /**
   * Recherche un participant par événement et personne.
   * Utilisé pour détecter les doublons.
   *
   * @param eventId - Identifiant de l'événement
   * @param personId - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findByEventAndPerson(eventId: string, personId: string, workspaceId: string) {
    return this.prisma.eventParticipant.findFirst({
      where: { eventId, personId, event: { workspaceId } },
      select: { id: true },
    });
  }

  /**
   * Crée un participant dans un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param data - Données validées du participant
   * @param normalizedFee - Cachet normalisé (null si non artiste)
   */
  async create(
    eventId: string,
    data: ParticipantInput,
    normalizedFee: number | null,
  ) {
    return this.prisma.eventParticipant.create({
      data: {
        eventId,
        personId: data.personId,
        roles: data.roles,
        rsvpStatus: data.rsvpStatus,
        plusOnes: data.plusOnes,
        dietary: data.dietary || null,
        setStart: data.setStart ? new Date(data.setStart) : null,
        setEnd: data.setEnd ? new Date(data.setEnd) : null,
        fee: normalizedFee,
        contractSigned: data.contractSigned,
        internalNotes: data.internalNotes || null,
      },
      include: { person: { select: personSelectShort } },
    });
  }

  /**
   * Met à jour un participant.
   *
   * @param id - Identifiant du participant
   * @param data - Données validées de mise à jour
   * @param normalizedFee - Cachet normalisé
   */
  async update(id: string, data: ParticipantInput, normalizedFee: number | null) {
    return this.prisma.eventParticipant.update({
      where: { id },
      data: {
        roles: data.roles,
        rsvpStatus: data.rsvpStatus,
        plusOnes: data.plusOnes,
        dietary: data.dietary || null,
        setStart: data.setStart ? new Date(data.setStart) : null,
        setEnd: data.setEnd ? new Date(data.setEnd) : null,
        fee: normalizedFee,
        contractSigned: data.contractSigned,
        internalNotes: data.internalNotes || null,
      },
      include: { person: { select: personSelectShort } },
    });
  }

  /**
   * Supprime un participant.
   *
   * @param id - Identifiant du participant
   */
  async delete(id: string) {
    return this.prisma.eventParticipant.delete({ where: { id } });
  }

  /**
   * Retourne la liste des personnes participant à un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findPersonsByEvent(eventId: string, workspaceId: string) {
    return this.prisma.eventParticipant.findMany({
      where: { eventId, event: { workspaceId } },
      select: { personId: true, person: { select: { id: true, fullName: true } } },
      orderBy: { person: { fullName: "asc" } },
    });
  }
}
