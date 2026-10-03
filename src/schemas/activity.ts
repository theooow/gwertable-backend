import { z } from "zod";
import { activityCategories } from "../lib/activity-catalog.js";

export const activityPreferencesSchema = z.object({
  taskCommentsEnabled: z.boolean(),
  budgetChangesEnabled: z.boolean(),
  taskDueSoonEnabled: z.boolean(),
  taskDueSoonMinutes: z.coerce.number().int().min(5).max(10080),
  equipmentChangesEnabled: z.boolean().optional(),
  volunteerChangesEnabled: z.boolean().optional(),
});

export const activityQuerySchema = z.object({
  eventId: z.string().min(1).optional(),
  category: z.enum(activityCategories).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const activityNotificationParamsSchema = z.object({ id: z.string().min(1) });
