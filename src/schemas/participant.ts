import { z } from "zod";

export const participantSchema = z.object({
  personId: z.string().min(1, "La personne est requise"),
  roles: z
    .array(z.enum(["GUEST", "VOLUNTEER", "ARTIST", "STAFF", "SUPPLIER"]))
    .min(1, "Au moins un role est requis"),
  rsvpStatus: z.enum(["UNKNOWN", "YES", "NO", "MAYBE"]).default("UNKNOWN"),
  plusOnes: z.number().int().min(0).default(0),
  dietary: z.string().optional().or(z.literal("")),
  setStart: z.string().optional().or(z.literal("")),
  setEnd: z.string().optional().or(z.literal("")),
  fee: z.string().optional().or(z.literal("")),
  contractSigned: z.boolean().default(false),
  internalNotes: z.string().optional().or(z.literal("")),
});
