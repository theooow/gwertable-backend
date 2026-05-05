import { z } from "zod";

export const expenseSchema = z.object({
  label: z.string().min(1, "Le libelle est requis"),
  amount: z.string().min(1, "Le montant est requis"),
  category: z.string().min(1, "La categorie est requise"),
  paidById: z.string().optional().or(z.literal("")),
  paidAt: z.string().optional().or(z.literal("")),
  reimbursement: z.enum(["PENDING", "DONE", "NOT_OWED"]).default("PENDING"),
  receiptUrl: z.string().url("URL invalide").optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});
