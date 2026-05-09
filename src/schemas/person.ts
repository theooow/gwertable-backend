import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const personSchema = z.object({
  fullName: requiredText("Le nom", LIMITS.name),
  email: z.string().trim().max(LIMITS.email).email("Email invalide").optional().or(z.literal("")),
  phone: optionalText("Le telephone", LIMITS.phone),
  discordUserId: optionalText("L'identifiant Discord", LIMITS.discordId),
  tags: z.array(z.string().trim().min(1).max(LIMITS.tag)).max(LIMITS.tags).default([]),
  notes: optionalText("Les notes", LIMITS.longText),
  contactType: z.enum(["CONTACT", "ARTIST", "SUPPLIER", "VENUE"]).default("CONTACT"),
  availability: optionalText("La disponibilite", LIMITS.longText),
  negotiatedPrices: optionalText("Les tarifs negocies", LIMITS.longText),
  specialConditions: optionalText("Les conditions speciales", LIMITS.longText),
  technicalConstraints: optionalText("Les contraintes techniques", LIMITS.longText),
  averageFee: z.coerce.number().int().min(0).optional(),
  bookingContact: optionalText("Le contact booking", LIMITS.mediumText),
  musicalStyle: optionalText("Le style musical", LIMITS.mediumText),
  riderNotes: optionalText("Les notes rider", LIMITS.longText),
  venueCapacity: z.coerce.number().int().min(0).optional(),
  soundConstraints: optionalText("Les contraintes sonores", LIMITS.longText),
  openingHours: optionalText("Les horaires d'ouverture", LIMITS.mediumText),
  electricalPower: optionalText("L'alimentation electrique", LIMITS.mediumText),
  securityContact: optionalText("Le contact securite", LIMITS.mediumText),
  sensibleNeighborhood: z.boolean().default(false),
});

export type PersonInput = z.infer<typeof personSchema>;
