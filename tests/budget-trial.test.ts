import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

const trial = {
  eventName: "Soirée de rentrée", eventDate: "2026-11-14", ticketPriceCents: 1200, capacity: 300,
  venueCents: 150000, artistsCents: 80000, techCommsCents: 0, barSpendPerPersonCents: 900,
};

async function startTrial(email = "Orga@Asso.test") {
  const response = await request("POST", "/api/public/budget-trial", undefined, { email, anonymousId: "anon-12345678" });
  assert.equal(response.statusCode, 201);
  return json<{ token: string }>(response).token;
}

describe("budget trial", () => {
  it("lets a prospect save a trial with an unverified email and resume it from its token only", async () => {
    assert.equal((await request("POST", "/api/public/budget-trial", undefined, { email: "nope" })).statusCode, 400);
    const token = await startTrial();
    assert.deepEqual(json(await request("GET", `/api/public/budget-trial/${token}`)), { email: "orga@asso.test", trial: null, convertedEventId: null });

    assert.equal((await request("PUT", `/api/public/budget-trial/${token}`, undefined, { ...trial, capacity: 0 })).statusCode, 400);
    assert.equal((await request("PUT", `/api/public/budget-trial/${token}`, undefined, trial)).statusCode, 204);
    assert.deepEqual(json<{ trial: unknown }>(await request("GET", `/api/public/budget-trial/${token}`)).trial, trial);
    const lead = await prisma.budgetLead.findUniqueOrThrow({ where: { token } });
    assert.ok(lead.trialCompletedAt);
    assert.equal(lead.anonymousId, "anon-12345678");
    assert.equal((await request("GET", "/api/public/budget-trial/unknown-token-0000")).statusCode, 404);
  });

  it("turns the trial into a first event with a forecast budget, once", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const token = await startTrial();
    assert.equal((await request("POST", `/api/budget-trial/${token}/claim`, authorization)).statusCode, 400);
    await request("PUT", `/api/public/budget-trial/${token}`, undefined, trial);
    assert.equal((await request("POST", `/api/budget-trial/${token}/claim`)).statusCode, 401);

    const claimed = await request("POST", `/api/budget-trial/${token}/claim`, authorization);
    assert.equal(claimed.statusCode, 200);
    const { eventId } = json<{ eventId: string }>(claimed);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { ticketTiers: true, expenses: { orderBy: { label: "asc" } } } });
    assert.equal(event.workspaceId, workspace.id);
    assert.equal(event.name, "Soirée de rentrée");
    assert.equal(event.avgBasketCents, 900);
    assert.deepEqual(event.ticketTiers.map((tier) => [tier.publicPriceCents, tier.quantity]), [[1200, 300]]);
    assert.deepEqual(event.expenses.map((expense) => [expense.label, expense.amountCents, expense.phase]), [["Artistes", 80000, "FORECAST"], ["Salle", 150000, "FORECAST"]]);
    assert.ok(await prisma.activityEntry.findFirst({ where: { eventId, type: "EXPENSE_CREATED" } }));

    assert.deepEqual(json(await request("POST", `/api/budget-trial/${token}/claim`, authorization)), { eventId });
    assert.equal(await prisma.event.count(), 1);
    assert.equal((await request("PUT", `/api/public/budget-trial/${token}`, undefined, trial)).statusCode, 409);
  });

  it("stops reminders for every trial of the same person on unsubscribe", async () => {
    const first = await startTrial();
    await startTrial("orga@asso.test");
    await startTrial("other@asso.test");
    assert.equal((await request("POST", `/api/public/budget-trial/${first}/unsubscribe`)).statusCode, 204);
    assert.deepEqual((await prisma.budgetLead.findMany({ where: { unsubscribedAt: { not: null } } })).map((lead) => lead.email), ["orga@asso.test", "orga@asso.test"]);
  });
});
