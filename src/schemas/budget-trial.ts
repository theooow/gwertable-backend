import { z } from "zod";

const cents = (max: number) => z.number().int().min(0).max(max);

/** The few inputs the trial dashboard needs to project a result and a break-even point. */
export const budgetTrialSchema = z.object({
  eventName: z.string().trim().max(120).default(""),
  eventDate: z.iso.date().optional(),
  ticketPriceCents: cents(1_000_00),
  capacity: z.number().int().min(1).max(100_000),
  venueCents: cents(10_000_000_00),
  artistsCents: cents(10_000_000_00),
  techCommsCents: cents(10_000_000_00),
  barSpendPerPersonCents: cents(1_000_00),
});

export type BudgetTrial = z.infer<typeof budgetTrialSchema>;

export const budgetLeadSchema = z.object({
  email: z.email().max(254).transform((email) => email.toLowerCase()),
  anonymousId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

export const budgetTrialTokenSchema = z.object({ token: z.string().min(16).max(64) });
