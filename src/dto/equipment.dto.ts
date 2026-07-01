import type { Ownership } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";

type PersonRef = { id: string; fullName: string };

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
  owner: PersonRef | null;
  supplierId: string | null;
  supplier: PersonRef | null;
  photoUrl: string | null;
  color: string | null;
  unitPriceCents: number;
  amountInputMode: "HT" | "TTC";
  vatRateBasisPoints: number;
  rentalCoef: number;
  quantity: number;
  notes: string | null;
  archivedAt: Date | null;
};

type EquipmentItemWithRelations = {
  id: string;
  workspaceId: string;
  name: string;
  category: string;
  ownership: Ownership;
  ownerId: string | null;
  owner: PersonRef | null;
  supplierId: string | null;
  supplier: PersonRef | null;
  photoUrl: string | null;
  color: string | null;
  unitPriceCents: number;
  amountInputMode: "HT" | "TTC";
  vatRateBasisPoints: number;
  rentalCoef: Decimal;
  quantity: number;
  notes: string | null;
  archivedAt: Date | null;
};

/**
 * Convertit un enregistrement Prisma EquipmentItem en DTO public.
 */
export function toEquipmentItemDTO(item: EquipmentItemWithRelations): EquipmentItemDTO {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    name: item.name,
    category: item.category,
    ownership: item.ownership,
    ownerId: item.ownerId,
    owner: item.owner,
    supplierId: item.supplierId,
    supplier: item.supplier,
    photoUrl: item.photoUrl,
    color: item.color,
    unitPriceCents: item.unitPriceCents,
    amountInputMode: item.amountInputMode,
    vatRateBasisPoints: item.vatRateBasisPoints,
    rentalCoef: item.rentalCoef.toNumber(),
    quantity: item.quantity,
    notes: item.notes,
    archivedAt: item.archivedAt,
  };
}
