import { z } from "zod";

export const shoppingSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  quantity: z.string().min(1, "La quantite est requise"),
  unit: z.string().optional().or(z.literal("")),
  category: z.string().min(1, "La categorie est requise"),
  estimatedCents: z.string().optional().or(z.literal("")),
  buyerId: z.string().optional().or(z.literal("")),
});

export const boughtSchema = z.object({
  bought: z.boolean(),
});

export const boughtWithExpenseSchema = z.object({
  amountCents: z.number().int().min(0),
  paidById: z.string().nullable(),
});
