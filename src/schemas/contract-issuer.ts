import { z } from "zod";

const text = z.string().trim().max(240)
  .regex(/^[\x20-\x7e\xa0-\xff\n\r\tŒœŸ€’‘“”–—…]*$/, "Utilisez des caractères latins, sans emoji.").default("");
export const contractIssuerSchema = z.object({
  legalName: text, legalForm: text, address: text, postalCode: text, city: text, country: text,
  representative: text, representativeRole: text,
  email: z.union([z.email().max(254), z.literal("")]).default(""),
  phone: text,
  siret: z.string().trim().regex(/^(\d{14})?$/, "Le SIRET doit contenir 14 chiffres.").default(""),
  rna: z.string().trim().regex(/^(W\d{9})?$/, "Le numéro RNA doit commencer par W suivi de 9 chiffres.").default(""),
});
const required = {
  legalName: "Nom légal", legalForm: "Forme juridique", address: "Adresse", postalCode: "Code postal",
  city: "Ville", country: "Pays", representative: "Représentant", representativeRole: "Fonction du représentant", email: "Email de contact",
} as const;
export function contractIssuerMissing(value: unknown) {
  const issuer = contractIssuerSchema.parse(value ?? {});
  return Object.entries(required).filter(([key]) => !issuer[key as keyof typeof required]).map(([, label]) => label);
}
