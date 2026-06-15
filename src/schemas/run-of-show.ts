import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const runOfShowSchema = z.object({
  trackId: z.string().optional().or(z.literal("")),
  sectionId: z.string().optional().or(z.literal("")),
  status: z.enum(["PLANNED", "IN_PROGRESS", "DONE", "DELAYED", "CANCELLED"]).optional(),
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
  stakeholderNote: optionalText("La note stakeholder", LIMITS.longText),
  delayReason: optionalText("La raison du retard", LIMITS.longText),
  actualStartedAt: z.string().optional().or(z.literal("")),
  completedAt: z.string().optional().or(z.literal("")),
  dependsOnIds: z.array(z.string()).max(20, "Un element ne peut pas dependre de plus de 20 elements").optional(),
});

export const runOfShowTrackSchema = z.object({
  name: requiredText("Le metier", LIMITS.name),
  color: optionalText("La couleur", LIMITS.shortText),
});

export const runOfShowSectionSchema = z.object({
  name: requiredText("La section", LIMITS.name),
  color: optionalText("La couleur", LIMITS.shortText),
});
