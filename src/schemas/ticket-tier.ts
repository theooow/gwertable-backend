import { z } from "zod";
import { LIMITS, requiredText } from "./limits.js";

export const ticketTierSchema = z.object({
  name: requiredText("Le nom", LIMITS.name),
  organizerRevenueCents: z.number().int().min(0),
  publicPriceCents: z.number().int().min(0),
  quantity: z.number().int().min(0),
  sold: z.number().int().min(0).optional(),
  excludeFromBreakEven: z.boolean().optional(),
});

export type TicketTierInput = z.infer<typeof ticketTierSchema>;
