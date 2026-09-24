import { z } from "zod";

// PDFKit's built-in font supports this alphabet. Reject unsupported characters
// rather than presenting a PDF that differs from the text accepted by the signer.
const text = (min: number, max: number) => z.string().trim().min(min).max(max)
  .regex(/^[\x20-\x7e\xa0-\xff\n\r\tŒœŸ€’‘“”–—…]*$/, "Utilisez des caractères latins, sans emoji.");
export const contractInput = z.object({
  applicationId: z.string().min(1), title: text(3, 160),
  organization: text(3, 1000), representative: text(3, 200),
  terms: text(50, 30000), authorized: z.literal(true),
});
export const signatureInput = z.object({
  code: z.string().regex(/^\d{6}$/), documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  name: text(3, 200), consent: z.literal(true),
});
export const SIGNATURE_CONSENT = "J’ai lu la convention et j’accepte ses conditions. Je confirme mon identité et signe électroniquement ce document en saisissant le code reçu à mon adresse email.";
