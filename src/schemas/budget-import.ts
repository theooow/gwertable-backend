import { z } from "zod";
import { expenseSchema } from "./expense.js";
import { incomeSchema } from "./income.js";

export const budgetImportPreviewSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  data: z.string().min(1),
});

export const expenseImportConfirmSchema = budgetImportPreviewSchema.extend({
  lines: z.array(expenseSchema.omit({ receiptUrl: true })).min(1).max(100),
});

export const incomeImportConfirmSchema = z.object({
  lines: z.array(incomeSchema).min(1).max(100),
});

export type BudgetImportPreviewInput = z.infer<typeof budgetImportPreviewSchema>;
export type ExpenseImportConfirmInput = z.infer<typeof expenseImportConfirmSchema>;
export type IncomeImportConfirmInput = z.infer<typeof incomeImportConfirmSchema>;
