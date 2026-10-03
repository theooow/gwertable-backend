import { z } from "zod";
import { LIMITS, requiredText } from "./limits.js";

const MAX_CENTS = 100_000_000_00;
const day = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} doit être au format AAAA-MM-JJ`);
const cents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS);

export const fiscalYearSchema = z.object({
  label: requiredText("Le libellé", LIMITS.name),
  startsOn: day("La date d'ouverture"),
  endsOn: day("La date de clôture"),
  framework: z.enum(["ASSOCIATION", "COMPANY"]).default("ASSOCIATION"),
  openingCashCents: cents.default(0),
  closingBankBalanceCents: cents.nullable().default(null),
});

export type FiscalYearInput = z.infer<typeof fiscalYearSchema>;
