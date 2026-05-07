import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const runOfShowSchema = z.object({
  startsAt: z.string().min(1, "L'heure de debut est requise"),
  durationMin: z.coerce
    .number()
    .int("La duree doit etre un nombre entier")
    .min(1, "La duree doit etre d'au moins 1 minute")
    .max(1440, "La duree ne peut pas depasser 24 heures"),
  title: requiredText("Le titre", LIMITS.name),
  responsible: optionalText("Le responsable", LIMITS.shortText),
  responsiblePersonId: z.string().optional().or(z.literal("")),
  notes: optionalText("Les notes", LIMITS.longText),
});
