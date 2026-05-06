import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const expenseSchema = z.object({
  label: requiredText("Le libelle", LIMITS.name),
  amount: requiredText("Le montant", LIMITS.money),
  category: requiredText("La categorie", LIMITS.shortText),
  paidById: z.string().optional().or(z.literal("")),
  paidAt: z.string().optional().or(z.literal("")),
  reimbursement: z.enum(["PENDING", "DONE", "NOT_OWED"]).default("PENDING"),
  receiptUrl: optionalText("L'URL du justificatif", LIMITS.url),
  notes: optionalText("Les notes", LIMITS.longText),
});
