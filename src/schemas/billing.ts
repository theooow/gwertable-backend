import { z } from "zod";

export const checkoutSchema = z.object({
  plan: z.enum(["LITE", "PLUS", "PRO"]),
  interval: z.enum(["month", "year"]).default("month"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** manage opens the portal home; update and cancel jump straight to that step. */
export const portalSchema = z.object({ flow: z.enum(["manage", "update", "cancel"]).default("manage") });

export type PortalInput = z.infer<typeof portalSchema>;

/** Documentation only: the webhook reads the raw payload to verify the Stripe signature. */
export const stripeEventSchema = z.looseObject({ id: z.string(), type: z.string() });
