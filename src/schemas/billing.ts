import { z } from "zod";

export const checkoutSchema = z.object({
  plan: z.enum(["LITE", "PLUS", "PRO"]),
  interval: z.enum(["month", "year"]).default("month"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Documentation only: the webhook reads the raw payload to verify the Stripe signature. */
export const stripeEventSchema = z.looseObject({ id: z.string(), type: z.string() });
