import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { BillingRepository } from "../repositories/billing.repository.js";
import { checkoutSchema, portalSchema, stripeEventSchema } from "../schemas/billing.js";
import { BillingService } from "../services/billing.service.js";

export const billingService = new BillingService(new BillingRepository(prisma));

export async function billingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/billing/subscription", { config: { documentation: {} } }, async (request) => {
    return billingService.getSubscription(request.user!.id);
  });

  fastify.post("/api/billing/checkout", { config: { documentation: { body: checkoutSchema } } }, async (request) => {
    return billingService.startCheckout(request.user!.id, checkoutSchema.parse(request.body));
  });

  fastify.post("/api/billing/portal", { config: { documentation: { body: portalSchema } } }, async (request) => {
    return billingService.openPortal(request.user!.id, portalSchema.parse(request.body ?? {}));
  });

  await fastify.register(async (webhook) => {
    // The Stripe signature covers the exact bytes received, so JSON stays unparsed here.
    webhook.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    webhook.post("/api/public/billing/webhook", { config: { documentation: { body: stripeEventSchema } } }, async (request) => {
      const signature = request.headers["stripe-signature"];
      await billingService.handleWebhook(request.body as Buffer, Array.isArray(signature) ? signature[0] : signature);
      return { received: true };
    });
  });
}
