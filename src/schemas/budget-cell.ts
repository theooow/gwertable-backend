import { z } from "zod";
import { LIMITS, requiredText } from "./limits.js";
import { INCOME_CATEGORIES } from "./income.js";

const date = z.union([z.literal(""), z.iso.datetime({ offset: true })]);
const fields = {
  label: requiredText("Le libellé", LIMITS.name).optional(),
  amount: z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/, "Montant invalide").refine((value) => Number(value.replace(",", ".")) <= 100000000, "Montant trop élevé").optional(),
  phase: z.enum(["FORECAST", "ACTUAL"]).optional(),
  amountInputMode: z.enum(["HT", "TTC"]).optional(),
  vatRateBasisPoints: z.number().int().min(0).max(10000).optional(),
};
const oneCell = (data: object) => Object.values(data).filter((value) => value !== undefined).length === 1;

export const expenseCellSchema = z.object({
  ...fields,
  category: requiredText("La catégorie", LIMITS.shortText).optional(),
  paidById: z.string().max(200).optional(),
  paidAt: date.optional(),
  reimbursement: z.enum(["PENDING", "DONE", "NOT_OWED"]).optional(),
  notes: z.string().max(LIMITS.longText).optional(),
}).strict().refine(oneCell, "Modifiez une cellule à la fois");

export const incomeCellSchema = z.object({
  ...fields,
  category: z.enum(INCOME_CATEGORIES).optional(),
  receivedAt: date.optional(),
}).strict().refine(oneCell, "Modifiez une cellule à la fois");

export type ExpenseCellInput = z.infer<typeof expenseCellSchema>;
export type IncomeCellInput = z.infer<typeof incomeCellSchema>;
