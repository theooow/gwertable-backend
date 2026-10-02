import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const participantSchema = z.object({
  personId: z.string().min(1, "La personne est requise"),
  roles: z
    .array(z.enum(["GUEST", "VOLUNTEER", "ARTIST", "STAFF", "SUPPLIER"]))
    .min(1, "Au moins un role est requis"),
  rsvpStatus: z.enum(["UNKNOWN", "YES", "NO", "MAYBE"]).default("UNKNOWN"),
  plusOnes: z.number().int().min(0).max(50).default(0),
  dietary: optionalText("Le regime alimentaire", LIMITS.mediumText),
  setStart: z.string().optional().or(z.literal("")),
  setEnd: z.string().optional().or(z.literal("")),
  fee: optionalText("Le cachet", LIMITS.money),
  contractSigned: z.boolean().default(false),
  internalNotes: optionalText("Les notes internes", LIMITS.longText),
});

export type ParticipantInput = z.infer<typeof participantSchema>;

export const participantCreateSchema = participantSchema
  .extend({
    personId: z.string().min(1).optional(),
    newPerson: z
      .object({
        fullName: requiredText("Le nom", LIMITS.name),
        email: z.string().trim().max(LIMITS.email).email("Email invalide").optional().or(z.literal("")),
        phone: optionalText("Le telephone", LIMITS.phone),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.personId) !== Boolean(value.newPerson), "Choisissez une personne existante ou creez-en une");

export type ParticipantCreateInput = z.infer<typeof participantCreateSchema>;
