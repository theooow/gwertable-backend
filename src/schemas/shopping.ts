import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const shoppingSchema = z.object({
  name: requiredText("Le nom", LIMITS.name),
  quantity: requiredText("La quantite", LIMITS.money),
  unit: optionalText("L'unite", LIMITS.shortText),
  category: requiredText("La categorie", LIMITS.shortText),
  estimatedCents: optionalText("Le montant estime", LIMITS.money),
  buyerId: z.string().optional().or(z.literal("")),
});

export const boughtSchema = z.object({
  bought: z.boolean(),
});

export const boughtWithExpenseSchema = z.object({
  amountCents: z.number().int().min(0),
  paidById: z.string().nullable(),
});
