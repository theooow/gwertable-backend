/**
 * Représentation publique d'une personne dans l'espace de travail.
 */
export type PersonDTO = {
  id: string;
  workspaceId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  discordUserId: string | null;
  notes: string | null;
  tags: string[];
  archivedAt: Date | null;
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
  archivedAt: Date | null;
};

/**
 * Convertit un enregistrement Prisma Person en DTO public.
 *
 * @param person - Enregistrement Prisma
 * @returns DTO de la personne
 */
export function toPersonDTO(person: PersonRecord): PersonDTO {
  return {
    id: person.id,
    workspaceId: person.workspaceId,
    fullName: person.fullName,
    email: person.email,
    phone: person.phone,
    discordUserId: person.discordUserId,
    notes: person.notes,
    tags: person.tags,
    archivedAt: person.archivedAt,
  };
}
