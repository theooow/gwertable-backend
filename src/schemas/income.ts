import { z } from "zod";
import { LIMITS, requiredText } from "./limits.js";

export const INCOME_CATEGORIES = ["bar", "merch", "caisse", "sponsor", "autre"] as const;

export const incomeSchema = z.object({
  label: requiredText("Le libelle", LIMITS.name),
  amountCents: z.number().int().min(0),
  category: z.enum(INCOME_CATEGORIES),
  receivedAt: z.string().optional().or(z.literal("")),
});

export type IncomeInput = z.infer<typeof incomeSchema>;
