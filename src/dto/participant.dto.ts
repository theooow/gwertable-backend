import type { Decimal } from "@prisma/client/runtime/library";

type ParticipantRecord = {
  id: string;
  eventId: string;
  personId: string;
  person?: { id: string; fullName: string; email?: string | null } | null;
  roles: string[];
  rsvpStatus: string;
  plusOnes: number;
  dietary: string | null;
  setStart: Date | null;
  setEnd: Date | null;
  fee: Decimal | null;
  contractSigned: boolean;
  internalNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Représentation publique d'un participant à un événement.
 * Les champs sensibles (`fee`, `internalNotes`) sont masqués selon le rôle.
 */
export type ParticipantDTO = {
  id: string;
  eventId: string;
  personId: string;
  person?: { id: string; fullName: string; email?: string | null } | null;
  roles: string[];
  rsvpStatus: string;
  plusOnes: number;
  dietary: string | null;
  setStart: Date | null;
  setEnd: Date | null;
  fee: string | null;
  contractSigned: boolean;
  internalNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Convertit un enregistrement Prisma EventParticipant en DTO public.
 * Masque le cachet et les notes internes selon les droits de l'utilisateur.
 *
 * @param participant - Enregistrement Prisma
 * @param canSeeSensitive - Si `true`, expose le cachet et les notes internes
 * @returns DTO du participant
 */
export function toParticipantDTO(
  participant: ParticipantRecord,
  canSeeSensitive: boolean,
): ParticipantDTO {
  return {
    id: participant.id,
    eventId: participant.eventId,
    personId: participant.personId,
    person: "person" in participant ? participant.person : undefined,
    roles: participant.roles,
    rsvpStatus: participant.rsvpStatus,
    plusOnes: participant.plusOnes,
    dietary: participant.dietary,
    setStart: participant.setStart,
    setEnd: participant.setEnd,
    fee: canSeeSensitive && participant.fee ? participant.fee.toString() : null,
    contractSigned: participant.contractSigned,
    internalNotes: canSeeSensitive ? participant.internalNotes : null,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  };
}
