import { z } from "zod";
import { LIMITS, requiredText } from "./limits.js";

export const collectiveSchema = z.object({
  name: requiredText("Le nom", LIMITS.name),
  shareBasisPoints: z.number().int().min(0).max(10000).optional().default(0),
  participantIds: z.array(z.string().min(1)).max(200).optional().default([]),
});

export const profitSplitSchema = z.object({
  profitSplitMode: z.enum(["EQUAL", "PRO_RATA_INVESTMENT", "CUSTOM"]),
});

export type CollectiveInput = z.infer<typeof collectiveSchema>;
export type ProfitSplitInput = z.infer<typeof profitSplitSchema>;
