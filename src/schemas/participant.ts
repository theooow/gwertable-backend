import { z } from "zod";
import { LIMITS, optionalText } from "./limits.js";

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
