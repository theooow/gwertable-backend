import { z } from "zod";
import { LIMITS, optionalText } from "./limits.js";

const reminderOffsets = z
  .array(z.coerce.number().int().positive().max(10080))
  .max(5)
  .transform((values) => [...new Set(values)].sort((a, b) => b - a));

export const eventNotificationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  discordChannelId: optionalText("Le canal Discord", LIMITS.shortText),
  whatsappEnabled: z.boolean().default(false),
  taskReminderOffsetsMinutes: reminderOffsets.default([1440, 60]),
  runOfShowReminderOffsetsMinutes: reminderOffsets.default([30]),
  overdueEnabled: z.boolean().default(true),
});

export type EventNotificationSettingsInput = z.infer<typeof eventNotificationSettingsSchema>;
