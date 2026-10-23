import type Stripe from "stripe";
import type { UsagePlan } from "@prisma/client";
import { env } from "../env.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { stripe } from "../lib/stripe.js";
import { sendBillingIssueEmail, type BillingIssue } from "../lib/mailer.js";
import { activeGrant, effectivePlan, ENTITLED_SUBSCRIPTION_STATUSES as ENTITLED_STATUSES } from "../lib/usage-plans.js";
import type { BillingRepository, BillingUser } from "../repositories/billing.repository.js";
import type { CheckoutInput, PortalInput } from "../schemas/billing.js";

type PaidPlan = CheckoutInput["plan"];

const SUBSCRIPTION_EVENTS = new Set<string>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

/** Prices are looked up by key so test and live accounts share the same code. */
export function priceLookupKey(plan: PaidPlan, interval: CheckoutInput["interval"]) {
  return `abregi_${plan.toLowerCase()}_${interval === "year" ? "yearly" : "monthly"}`;
}

function planFromPrice(price: Stripe.Price | undefined): PaidPlan | null {
  const plan = price?.lookup_key?.match(/^abregi_(lite|plus|pro)_/)?.[1]?.toUpperCase();
  return plan === "LITE" || plan === "PLUS" || plan === "PRO" ? plan : null;
}

const fromUnix = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);

/**
 * Subscriptions run on Stripe Billing: hosted Checkout to subscribe, the Customer Portal to
 * change plan, cancel or update the card, and webhooks to mirror the state onto `User.usagePlan`.
 */
export class BillingService {
  constructor(private readonly repository: BillingRepository) {}

  async getSubscription(userId: string) {
    const user = await this.repository.findUser(userId);
    return {
      enabled: Boolean(env.STRIPE_SECRET_KEY),
      usagePlan: user.usagePlan,
      status: user.subscriptionStatus,
      interval: user.subscriptionInterval,
      currentPeriodEnd: user.subscriptionPeriodEnd,
      cancelAtPeriodEnd: user.subscriptionCancelAtPeriodEnd,
      trialEndsAt: user.trialEndsAt,
      trialAvailable: !user.trialStartedAt,
      trialDays: env.BILLING_TRIAL_DAYS,
      canManage: Boolean(user.stripeCustomerId),
      grantedPlan: activeGrant(user),
      grantedUntil: activeGrant(user) ? user.planGrantUntil : null,
    };
  }

  async startCheckout(userId: string, { plan, interval }: CheckoutInput) {
    const user = await this.repository.findUser(userId);
    const [price] = (await stripe().prices.list({ lookup_keys: [priceLookupKey(plan, interval)], active: true, limit: 1 })).data;
    if (!price) throw new ValidationError("Ce plan n'est pas encore disponible au paiement.");
    if (user.stripeCustomerId && user.stripeSubscriptionId && ENTITLED_STATUSES.has(user.subscriptionStatus ?? "")) {
      // Subscribers confirm the new price in the portal, where Stripe handles proration.
      const [item] = (await stripe().subscriptions.retrieve(user.stripeSubscriptionId)).items.data;
      if (!item) throw new ValidationError("Cet abonnement ne peut pas changer de plan.");
      return this.portal(user.stripeCustomerId, {
        type: "subscription_update_confirm",
        subscription_update_confirm: { subscription: user.stripeSubscriptionId, items: [{ id: item.id, price: price.id, quantity: 1 }] },
        after_completion: { type: "redirect", redirect: { return_url: `${env.FRONTEND_URL}/settings?billing=updated#subscription` } },
      });
    }

    const trial = !user.trialStartedAt && env.BILLING_TRIAL_DAYS > 0;
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: await this.ensureCustomer(user),
      client_reference_id: user.id,
      line_items: [{ price: price.id, quantity: 1 }],
      locale: "fr",
      payment_method_collection: "always",
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      automatic_tax: { enabled: env.STRIPE_AUTOMATIC_TAX },
      allow_promotion_codes: true,
      custom_text: { submit: { message: `En t'abonnant, tu acceptes les conditions générales de vente : ${env.FRONTEND_URL}/cgv` } },
      subscription_data: {
        metadata: { userId: user.id },
        ...(trial ? { trial_period_days: env.BILLING_TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
      },
      success_url: `${env.FRONTEND_URL}/abonnement?billing=success`,
      cancel_url: `${env.FRONTEND_URL}/abonnement`,
    });
    if (!session.url) throw new ValidationError("La page de paiement n'a pas pu être créée.");
    return { url: session.url };
  }

  async openPortal(userId: string, { flow }: PortalInput) {
    const user = await this.repository.findUser(userId);
    if (!user.stripeCustomerId) throw new NotFoundError("Aucun abonnement à gérer pour ce compte.");
    const subscription = user.stripeSubscriptionId;
    if (flow === "manage" || !subscription || !ENTITLED_STATUSES.has(user.subscriptionStatus ?? "")) return this.portal(user.stripeCustomerId);
    const back = { type: "redirect" as const, redirect: { return_url: `${env.FRONTEND_URL}/settings#subscription` } };
    return this.portal(user.stripeCustomerId, flow === "cancel"
      ? { type: "subscription_cancel", subscription_cancel: { subscription }, after_completion: back }
      : { type: "subscription_update", subscription_update: { subscription }, after_completion: back });
  }

  async handleWebhook(payload: Buffer, signature: string | undefined) {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new ValidationError("Webhook Stripe non configuré.");
    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(payload, signature ?? "", env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new ValidationError("Signature Stripe invalide.");
    }
    if (await this.repository.isEventProcessed(event.id)) return;

    if (event.type === "checkout.session.completed" && event.data.object.mode === "subscription") {
      const { subscription } = event.data.object;
      if (subscription) await this.syncSubscription(typeof subscription === "string" ? subscription : subscription.id);
    } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
      await this.syncSubscription((event.data.object as Stripe.Subscription).id);
    }
    await this.repository.markEventProcessed(event.id, event.type);
  }

  /** The trial lasts until the first closed event when that comes before its end date. */
  async endTrialAfterClosedEvent(userId: string) {
    const user = await this.repository.findUser(userId);
    if (user.subscriptionStatus !== "trialing" || !user.stripeSubscriptionId) return;
    await stripe().subscriptions.update(user.stripeSubscriptionId, { trial_end: "now", proration_behavior: "none" });
  }

  /** Events can arrive out of order, so the subscription is always re-read from Stripe. */
  private async syncSubscription(subscriptionId: string) {
    const subscription = await stripe().subscriptions.retrieve(subscriptionId);
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const user = (await this.repository.findUserByCustomer(customerId))
      ?? (subscription.metadata.userId ? await this.repository.findUser(subscription.metadata.userId) : null);
    if (!user) return;
    const entitled = ENTITLED_STATUSES.has(subscription.status);
    // An older subscription ending must not override the one currently in use.
    if (!entitled && user.stripeSubscriptionId && user.stripeSubscriptionId !== subscription.id) return;

    const item = subscription.items.data[0];
    const plan = planFromPrice(item?.price);
    const subscriptionPlan: UsagePlan | null = entitled && plan ? plan : null;
    const usagePlan = effectivePlan({ ...user, subscriptionPlan, subscriptionStatus: subscription.status });
    const trialStartedAt = fromUnix(subscription.trial_start);
    await this.repository.applySubscription(user.id, {
      usagePlan,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      subscriptionPlan,
      subscriptionInterval: item?.price.recurring?.interval ?? null,
      subscriptionPeriodEnd: fromUnix(item?.current_period_end),
      subscriptionCancelAtPeriodEnd: subscription.cancel_at_period_end,
      trialEndsAt: subscription.status === "trialing" ? fromUnix(subscription.trial_end) : null,
      ...(trialStartedAt && !user.trialStartedAt ? { trialStartedAt } : {}),
    });
    await this.notifyBillingIssue(user, subscription.status);
  }

  /** Warns on the first failed payment, then when retries give up and the subscription ends. */
  private async notifyBillingIssue(user: BillingUser, status: string) {
    const previous = user.subscriptionStatus;
    const issue: BillingIssue | null = status === "past_due" && previous !== "past_due" ? "payment_failed"
      : (status === "canceled" || status === "unpaid") && previous === "past_due" ? "suspended"
      : null;
    if (!issue) return;
    // The subscription state is already saved: a mail outage must not make Stripe retry the webhook.
    await sendBillingIssueEmail({ email: user.billingEmail ?? user.email, issue, settingsUrl: `${env.FRONTEND_URL}/settings#subscription` }).catch(() => undefined);
  }

  private async ensureCustomer(user: BillingUser) {
    if (user.stripeCustomerId) return user.stripeCustomerId;
    const customer = await stripe().customers.create(
      {
        email: user.billingEmail ?? user.email,
        name: user.companyName ?? user.name ?? undefined,
        preferred_locales: ["fr"],
        metadata: { userId: user.id },
        invoice_settings: env.STRIPE_INVOICE_FOOTER ? { footer: env.STRIPE_INVOICE_FOOTER } : undefined,
      },
      { idempotencyKey: `customer-${user.id}` },
    );
    await this.repository.setCustomer(user.id, customer.id);
    return customer.id;
  }

  private async portal(customer: string, flow_data?: Stripe.BillingPortal.SessionCreateParams.FlowData) {
    const session = await stripe().billingPortal.sessions.create({ customer, locale: "fr", return_url: `${env.FRONTEND_URL}/settings#subscription`, flow_data });
    return { url: session.url };
  }
}
