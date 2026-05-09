import type { Decimal } from "@prisma/client/runtime/library";

type ShoppingRecord = {
  id: string;
  eventId: string;
  name: string;
  quantity: Decimal;
  unit: string | null;
  category: string;
  estimatedCents: number | null;
  buyerId: string | null;
  buyer?: { id: string; fullName: string } | null;
  bought: boolean;
  expenseId: string | null;
};

/**
 * Représentation publique d'un article de courses.
 * La quantité est sérialisée en chaîne de caractères (conversion depuis Prisma `Decimal`).
 */
export type ShoppingItemDTO = {
  id: string;
  eventId: string;
  name: string;
  quantity: string;
  unit: string | null;
  category: string;
  estimatedCents: number | null;
  buyerId: string | null;
  buyer?: { id: string; fullName: string } | null;
  bought: boolean;
  expenseId: string | null;
};

/**
 * Convertit un enregistrement Prisma ShoppingItem en DTO public.
 *
 * @param item - Enregistrement Prisma avec la relation `buyer` incluse
 * @returns DTO de l'article
 */
export function toShoppingItemDTO(item: ShoppingRecord): ShoppingItemDTO {
  return {
    id: item.id,
    eventId: item.eventId,
    name: item.name,
    quantity: item.quantity.toString(),
    unit: item.unit,
    category: item.category,
    estimatedCents: item.estimatedCents,
    buyerId: item.buyerId,
    buyer: "buyer" in item ? item.buyer : undefined,
    bought: item.bought,
    expenseId: item.expenseId,
  };
}
