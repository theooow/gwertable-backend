import { z } from "zod";
import { LIMITS, requiredText } from "./limits.js";

export const consumableSchema = z.object({
  name: requiredText("Le nom", LIMITS.name),
  unitPriceCents: z.number().int().min(0),
  estimatedQty: z.number().min(0).optional().default(0),
});

export type ConsumableInput = z.infer<typeof consumableSchema>;
