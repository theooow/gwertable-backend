import type { Ownership } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";

/**
 * Représentation publique d'un équipement du catalogue de l'espace de travail.
 * `rentalCoef` est sérialisé en nombre flottant (conversion depuis Prisma `Decimal`).
 */
export type EquipmentItemDTO = {
  id: string;
  workspaceId: string;
  name: string;
  category: string;
  ownership: Ownership;
  ownerId: string | null;
  owner: { id: string; fullName: string } | null;
  unitPriceCents: number;
  rentalCoef: number;
  quantity: number;
  notes: string | null;
  archivedAt: Date | null;
};

type EquipmentItemWithOwner = {
  id: string;
  workspaceId: string;
  name: string;
  category: string;
  ownership: Ownership;
  ownerId: string | null;
  owner: { id: string; fullName: string } | null;
  unitPriceCents: number;
  rentalCoef: Decimal;
  quantity: number;
  notes: string | null;
  archivedAt: Date | null;
};

/**
 * Convertit un enregistrement Prisma EquipmentItem en DTO public.
 *
 * @param item - Enregistrement Prisma avec la relation `owner` incluse
 * @returns DTO de l'équipement
 */
export function toEquipmentItemDTO(item: EquipmentItemWithOwner): EquipmentItemDTO {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    name: item.name,
    category: item.category,
    ownership: item.ownership,
    ownerId: item.ownerId,
    owner: item.owner,
    unitPriceCents: item.unitPriceCents,
    rentalCoef: item.rentalCoef.toNumber(),
    quantity: item.quantity,
    notes: item.notes,
    archivedAt: item.archivedAt,
  };
}
