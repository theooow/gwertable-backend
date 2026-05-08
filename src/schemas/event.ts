import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const eventSchema = z
  .object({
    name: requiredText("Le nom", LIMITS.name),
    shotgunEventId: z.number().int().positive().optional().nullable(),
    startsAt: z.string().min(1, "La date de debut est requise"),
    endsAt: z.string().optional().or(z.literal("")),
    status: z.enum(["DRAFT", "PLANNING", "LIVE", "DONE", "ARCHIVED"]).default("DRAFT"),
    description: optionalText("La description", LIMITS.longText),
    bannerUrl: optionalText("L'URL de la banniere", LIMITS.url),
    venueId: z.string().optional().or(z.literal("")),
    nbCollectifs: z.number().int().min(1).optional().default(1),
  })
  .refine(
    (data) => {
      if (data.endsAt && data.startsAt) {
        return new Date(data.endsAt) > new Date(data.startsAt);
      }
      return true;
    },
    { message: "La date de fin doit etre apres la date de debut", path: ["endsAt"] },
  );

export type EventInput = z.infer<typeof eventSchema>;
