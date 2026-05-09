import type { PersonType } from "@prisma/client";

export type PersonDocumentDTO = {
  id: string;
  personId: string;
  label: string;
  url: string;
  isUpload: boolean;
  category: string;
  createdAt: Date;
};

export type PersonHistoryNoteDTO = {
  id: string;
  personId: string;
  body: string;
  eventDate: Date | null;
  createdAt: Date;
};

export type PersonCollaborationDTO = {
  id: string;
  roles: string[];
  event: { id: string; name: string; startsAt: Date; endsAt: Date | null };
};

export type PersonDTO = {
  id: string;
  workspaceId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  discordUserId: string | null;
  notes: string | null;
  tags: string[];
  contactType: PersonType;
  availability: string | null;
  negotiatedPrices: string | null;
  specialConditions: string | null;
  technicalConstraints: string | null;
  averageFee: number | null;
  bookingContact: string | null;
  musicalStyle: string | null;
  riderNotes: string | null;
  venueCapacity: number | null;
  soundConstraints: string | null;
  openingHours: string | null;
  electricalPower: string | null;
  securityContact: string | null;
  sensibleNeighborhood: boolean;
  archivedAt: Date | null;
};

export type PersonDetailDTO = PersonDTO & {
  documents: PersonDocumentDTO[];
  historyNotes: PersonHistoryNoteDTO[];
  collaborations: PersonCollaborationDTO[];
};

type PersonRecord = {
  id: string;
  workspaceId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  discordUserId: string | null;
  notes: string | null;
  tags: string[];
  contactType: PersonType;
  availability: string | null;
  negotiatedPrices: string | null;
  specialConditions: string | null;
  technicalConstraints: string | null;
  averageFee: number | null;
  bookingContact: string | null;
  musicalStyle: string | null;
  riderNotes: string | null;
  venueCapacity: number | null;
  soundConstraints: string | null;
  openingHours: string | null;
  electricalPower: string | null;
  securityContact: string | null;
  sensibleNeighborhood: boolean;
  archivedAt: Date | null;
};

function toPersonFields(person: PersonRecord): PersonDTO {
  return {
    id: person.id,
    workspaceId: person.workspaceId,
    fullName: person.fullName,
    email: person.email,
    phone: person.phone,
    discordUserId: person.discordUserId,
    notes: person.notes,
    tags: person.tags,
    contactType: person.contactType,
    availability: person.availability,
    negotiatedPrices: person.negotiatedPrices,
    specialConditions: person.specialConditions,
    technicalConstraints: person.technicalConstraints,
    averageFee: person.averageFee,
    bookingContact: person.bookingContact,
    musicalStyle: person.musicalStyle,
    riderNotes: person.riderNotes,
    venueCapacity: person.venueCapacity,
    soundConstraints: person.soundConstraints,
    openingHours: person.openingHours,
    electricalPower: person.electricalPower,
    securityContact: person.securityContact,
    sensibleNeighborhood: person.sensibleNeighborhood,
    archivedAt: person.archivedAt,
  };
}

export function toPersonDTO(person: PersonRecord): PersonDTO {
  return toPersonFields(person);
}

type PersonWithDetails = PersonRecord & {
  documents: Array<{
    id: string;
    personId: string;
    label: string;
    url: string;
    isUpload: boolean;
    category: string;
    createdAt: Date;
  }>;
  historyNotes: Array<{
    id: string;
    personId: string;
    body: string;
    eventDate: Date | null;
    createdAt: Date;
  }>;
  participations: Array<{
    id: string;
    roles: string[];
    event: { id: string; name: string; startsAt: Date; endsAt: Date | null };
  }>;
};

export function toPersonDetailDTO(person: PersonWithDetails): PersonDetailDTO {
  return {
    ...toPersonFields(person),
    documents: person.documents,
    historyNotes: person.historyNotes,
    collaborations: person.participations.map((p) => ({
      id: p.id,
      roles: p.roles,
      event: p.event,
    })),
  };
}
