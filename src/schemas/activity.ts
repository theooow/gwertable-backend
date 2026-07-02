import { z } from "zod";

export const activityPreferencesSchema = z.object({
  taskCommentsEnabled: z.boolean(),
  budgetChangesEnabled: z.boolean(),
  taskDueSoonEnabled: z.boolean(),
  taskDueSoonMinutes: z.coerce.number().int().min(5).max(10080),
});
