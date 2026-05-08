import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const equipmentItemSchema = z.object({
  name: requiredText("Le nom", LIMITS.name),
  category: requiredText("La catégorie", LIMITS.shortText),
  ownership: z.enum(["OWNED", "BORROWED", "RENTED"]),
  ownerId: z.string().optional().nullable(),
  unitPriceCents: z.number().int().min(0).default(0),
  rentalCoef: z.number().min(0).default(1),
  quantity: z.number().int().min(1).default(1),
  notes: optionalText("Les notes", LIMITS.longText),
});

export const equipmentUsageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("library"),
    itemId: z.string().min(1),
    quantity: z.number().int().min(1).default(1),
    unitPriceCents: z.number().int().min(0).optional(),
    rentalCoef: z.number().min(0).optional(),
    notes: optionalText("Les notes", LIMITS.longText),
  }),
  z.object({
    kind: z.literal("oneoff"),
    name: requiredText("Le nom", LIMITS.name),
    category: requiredText("La catégorie", LIMITS.shortText),
    quantity: z.number().int().min(1).default(1),
    unitPriceCents: z.number().int().min(0).default(0),
    rentalCoef: z.number().min(0).default(1),
    notes: optionalText("Les notes", LIMITS.longText),
  }),
]);

export const equipmentUsageUpdateSchema = z.object({
  quantity: z.number().int().min(1).default(1),
  unitPriceCents: z.number().int().min(0).optional(),
  rentalCoef: z.number().min(0).optional(),
  conditionBefore: z.string().optional().nullable(),
  conditionAfter: z.string().optional().nullable(),
  returned: z.boolean().optional(),
  notes: optionalText("Les notes", LIMITS.longText),
});

export type EquipmentItemInput = z.infer<typeof equipmentItemSchema>;
export type EquipmentUsageInput = z.infer<typeof equipmentUsageSchema>;
export type EquipmentUsageUpdateInput = z.infer<typeof equipmentUsageUpdateSchema>;
