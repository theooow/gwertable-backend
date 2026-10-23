import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import { stripe } from "../src/lib/stripe.js";
import { eventPayload, json, request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();

const client = stripe();
const originals = {
  pricesList: client.prices.list,
  customersCreate: client.customers.create,
  checkoutCreate: client.checkout.sessions.create,
  portalCreate: client.billingPortal.sessions.create,
  subscriptionsRetrieve: client.subscriptions.retrieve,
  subscriptionsUpdate: client.subscriptions.update,
};
afterEach(() => {
  client.prices.list = originals.pricesList;
  client.customers.create = originals.customersCreate;
  client.checkout.sessions.create = originals.checkoutCreate;
  client.billingPortal.sessions.create = originals.portalCreate;
  client.subscriptions.retrieve = originals.subscriptionsRetrieve;
  client.subscriptions.update = originals.subscriptionsUpdate;
});

const stub = <T>(value: T) => (async () => value) as never;

function subscription(overrides: Partial<{ status: string; lookupKey: string; customer: string; trialEnd: number | null }> = {}) {
  const { status = "trialing", lookupKey = "abregi_plus_monthly", customer = "cus_abregi", trialEnd = 1_800_000_000 } = overrides;
  return {
    id: "sub_abregi",
    customer,
    status,
    cancel_at_period_end: false,
    trial_start: 1_790_000_000,
    trial_end: trialEnd,
    metadata: {},
    items: { data: [{ current_period_end: 1_800_000_000, price: { lookup_key: lookupKey, recurring: { interval: "month" } } }] },
  } as unknown as Stripe.Response<Stripe.Subscription>;
}

function webhook(type: string, object: Record<string, unknown>, id = `evt_${type}`) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object } });
  const signature = client.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  return request("POST", "/api/public/billing/webhook", undefined, payload, { "content-type": "application/json", "stripe-signature": signature });
}

test("checkout opens a Stripe page with the trial for a first subscription", async () => {
  const { authorization, user } = await seedAdminSession("BETA_TEST");
  let lookupKeys: string[] | undefined;
  let checkout: Stripe.Checkout.SessionCreateParams | undefined;
  client.prices.list = (async (params: Stripe.PriceListParams) => { lookupKeys = params.lookup_keys; return { data: [{ id: "price_plus_year" }] }; }) as never;
  client.customers.create = stub({ id: "cus_abregi" });
  client.checkout.sessions.create = (async (params: Stripe.Checkout.SessionCreateParams) => { checkout = params; return { url: "https://checkout.stripe.test/s" }; }) as never;

  const response = await request("POST", "/api/billing/checkout", authorization, { plan: "PLUS", interval: "year" });
  assert.equal(response.statusCode, 200);
  assert.equal(json<{ url: string }>(response).url, "https://checkout.stripe.test/s");
  assert.deepEqual(lookupKeys, ["abregi_plus_yearly"]);
  assert.equal(checkout?.customer, "cus_abregi");
  assert.equal(checkout?.subscription_data?.trial_period_days, 60);
  assert.equal(checkout?.payment_method_collection, "always");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).stripeCustomerId, "cus_abregi");
  assert.equal((await request("POST", "/api/billing/checkout", authorization, { plan: "GOLD" })).statusCode, 400);
});

test("webhooks mirror the subscription onto the plan and ignore replays", async () => {
  const { authorization, user } = await seedAdminSession("BETA_TEST");
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: "cus_abregi" } });
  client.subscriptions.retrieve = stub(subscription());

  assert.equal((await webhook("customer.subscription.created", { id: "sub_abregi" })).statusCode, 200);
  const billing = json<{ usagePlan: string; status: string; trialAvailable: boolean; trialEndsAt: string }>(await request("GET", "/api/billing/subscription", authorization));
  assert.equal(billing.usagePlan, "PLUS");
  assert.equal(billing.status, "trialing");
  assert.equal(billing.trialAvailable, false);
  assert.ok(billing.trialEndsAt);

  client.subscriptions.retrieve = stub(subscription({ status: "canceled" }));
  assert.equal((await webhook("customer.subscription.created", { id: "sub_abregi" })).statusCode, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).usagePlan, "PLUS");

  assert.equal((await webhook("customer.subscription.deleted", { id: "sub_abregi" })).statusCode, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).usagePlan, "NONE");
});

test("webhooks with an invalid signature are refused", async () => {
  const response = await request("POST", "/api/public/billing/webhook", undefined, JSON.stringify({ id: "evt_x", type: "customer.subscription.updated" }), { "content-type": "application/json", "stripe-signature": "t=1,v1=forged" });
  assert.equal(response.statusCode, 400);
});

test("subscribers change plan in the portal and accounts without customer have nothing to manage", async () => {
  const { authorization, user } = await seedAdminSession("PLUS");
  assert.equal((await request("POST", "/api/billing/portal", authorization)).statusCode, 404);

  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: "cus_abregi", stripeSubscriptionId: "sub_abregi", subscriptionStatus: "active", trialStartedAt: new Date() } });
  let portal: Stripe.BillingPortal.SessionCreateParams | undefined;
  client.billingPortal.sessions.create = (async (params: Stripe.BillingPortal.SessionCreateParams) => { portal = params; return { url: "https://billing.stripe.test/p" }; }) as never;
  client.prices.list = stub({ data: [{ id: "price_pro_month" }] });
  client.subscriptions.retrieve = stub({ items: { data: [{ id: "si_abregi" }] } });
  const response = await request("POST", "/api/billing/checkout", authorization, { plan: "PRO" });
  assert.equal(json<{ url: string }>(response).url, "https://billing.stripe.test/p");
  assert.equal(portal?.customer, "cus_abregi");
  assert.equal(portal?.flow_data?.type, "subscription_update_confirm");
  assert.deepEqual(portal?.flow_data?.subscription_update_confirm?.items, [{ id: "si_abregi", price: "price_pro_month", quantity: 1 }]);

  await request("POST", "/api/billing/portal", authorization, { flow: "cancel" });
  assert.equal(portal?.flow_data?.type, "subscription_cancel");
  assert.equal(portal?.flow_data?.subscription_cancel?.subscription, "sub_abregi");
  await request("POST", "/api/billing/portal", authorization, {});
  assert.equal(portal?.flow_data, undefined);
});

test("closing an event during the trial ends it", async () => {
  const { authorization, user } = await seedAdminSession("PLUS");
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: "cus_abregi", stripeSubscriptionId: "sub_abregi", subscriptionStatus: "trialing" } });
  const updates: Stripe.SubscriptionUpdateParams[] = [];
  client.subscriptions.update = (async (_id: string, params: Stripe.SubscriptionUpdateParams) => { updates.push(params); return subscription({ status: "active" }); }) as never;
  const event = json<{ id: string }>(await request("POST", "/api/events", authorization, eventPayload));

  assert.equal((await request("PUT", `/api/events/${event.id}`, authorization, { ...eventPayload, name: "Renamed" })).statusCode, 200);
  assert.equal(updates.length, 0);
  assert.equal((await request("PUT", `/api/events/${event.id}`, authorization, { ...eventPayload, status: "DONE" })).statusCode, 200);
  assert.deepEqual(updates, [{ trial_end: "now", proration_behavior: "none" }]);
});

test("emails the customer on the first failed payment and when the subscription is suspended", async () => {
  const { user } = await seedAdminSession("BETA_TEST");
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: "cus_abregi", billingEmail: "factures@abregi.test" } });
  const issues: unknown[] = [];
  const originalInfo = console.info;
  console.info = (payload: unknown, message?: unknown) => { if (message === "Billing issue email skipped (log transport)") issues.push(payload); };
  try {
    for (const [status, id] of [["active", "a"], ["past_due", "b"], ["past_due", "c"], ["canceled", "d"]] as const) {
      client.subscriptions.retrieve = stub(subscription({ status }));
      assert.equal((await webhook("customer.subscription.updated", { id: "sub_abregi" }, `evt_${id}`)).statusCode, 200);
    }
  } finally {
    console.info = originalInfo;
  }
  assert.deepEqual(issues, [
    { email: "factures@abregi.test", issue: "payment_failed" },
    { email: "factures@abregi.test", issue: "suspended" },
  ]);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).usagePlan, "NONE");
});
