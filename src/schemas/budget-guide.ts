import { z } from "zod";

export const BUDGET_GUIDE_SKIPPABLE_STEPS = ["team", "collectives", "tickets", "consumables", "incomes"] as const;

export const budgetGuideSchema = z.object({
  hidden: z.boolean().optional(),
  skippedSteps: z.array(z.enum(BUDGET_GUIDE_SKIPPABLE_STEPS)).max(BUDGET_GUIDE_SKIPPABLE_STEPS.length).optional(),
  settingsChecked: z.boolean().optional(),
});

export type BudgetGuideInput = z.infer<typeof budgetGuideSchema>;
