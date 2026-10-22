import Stripe from "stripe";
import { env } from "../env.js";
import { ValidationError } from "./errors.js";

let client: Stripe | undefined;

export function stripe() {
  if (!env.STRIPE_SECRET_KEY) throw new ValidationError("Le paiement en ligne n'est pas encore disponible.");
  client ??= new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}
