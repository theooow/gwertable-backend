import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const personSchema = z.object({
  fullName: requiredText("Le nom", LIMITS.name),
  email: z.string().trim().max(LIMITS.email).email("Email invalide").optional().or(z.literal("")),
  phone: optionalText("Le telephone", LIMITS.phone),
  discordUserId: optionalText("L'identifiant Discord", LIMITS.discordId),
  tags: z.array(z.string().trim().min(1).max(LIMITS.tag)).max(LIMITS.tags).default([]),
  notes: optionalText("Les notes", LIMITS.longText),
});

export type PersonInput = z.infer<typeof personSchema>;
