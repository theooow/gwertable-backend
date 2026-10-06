import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

const DAY_MS = 86400000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

type Funnel = {
  steps: { key: string; users: number; eligible: number | null }[];
  sources: { source: string; visitors: number; signups: number; activated: number }[];
  medianHoursToFirstBudgetLine: number | null;
};

async function seedJourneys() {
  const workspace = await prisma.workspace.create({ data: { name: "Asso" } });
  const admin = await prisma.user.create({ data: { email: "theooow@hotmail.com", defaultWorkspaceId: workspace.id, emailVerified: new Date(),
    workspaceMemberships: { create: { workspaceId: workspace.id, role: "ADMIN" } } } });
  const session = await prisma.session.create({ data: { sessionToken: "funnel-admin", userId: admin.id, expires: new Date(Date.now() + 3600000) } });
  const orga = await prisma.user.create({ data: { email: "orga@abregi.test", createdAt: daysAgo(40), emailVerified: daysAgo(40),
    workspaceMemberships: { create: { workspaceId: workspace.id, role: "ADMIN" } } } });
  await prisma.user.create({ data: { email: "idle@abregi.test", createdAt: daysAgo(10) } });

  const [first, second] = await Promise.all(["Soirée", "Festival"].map((name) => prisma.event.create({ data: { workspaceId: workspace.id, name, startsAt: new Date() } })));
  await prisma.expense.create({ data: { eventId: first.id, label: "Son", amountCents: 1000, category: "son" } });
  await prisma.income.create({ data: { eventId: first.id, label: "Bar", amountCents: 3000, category: "bar" } });
  const activity = (type: string, eventId: string | null, createdAt: Date) => ({ workspaceId: workspace.id, actorId: orga.id, type, title: type, eventId, createdAt });
  await prisma.activityEntry.createMany({ data: [
    activity("EVENT_CREATED", first.id, daysAgo(40)),
    activity("EXPENSE_CREATED", first.id, new Date(daysAgo(40).getTime() + 2 * 3600000)),
    activity("INCOME_CREATED", first.id, daysAgo(38)),
    activity("MEMBER_INVITED", null, daysAgo(30)),
    activity("EXPENSE_UPDATED", first.id, daysAgo(5)),
    activity("EXPENSE_CREATED", second.id, daysAgo(5)),
    // Admin actions are never counted.
    { ...activity("EVENT_CREATED", first.id, daysAgo(1)), actorId: admin.id },
  ] });
  await prisma.workspaceInvitation.create({ data: { workspaceId: workspace.id, email: "friend@abregi.test", role: "TREASURER", token: "invite", expires: new Date(), acceptedAt: daysAgo(29) } });
  await prisma.budgetLead.createMany({ data: [
    { email: "orga@abregi.test", token: "lead-token-1-000000", trialCompletedAt: daysAgo(41), convertedAt: daysAgo(40) },
    { email: "orga@abregi.test", token: "lead-token-2-000000", createdAt: daysAgo(41) },
    { email: "curious@abregi.test", token: "lead-token-3-000000", trialCompletedAt: daysAgo(2) },
    { email: "bounce@abregi.test", token: "lead-token-4-000000", createdAt: daysAgo(3) },
  ] });
  await prisma.trackingEvent.createMany({ data: [
    { name: "landing_viewed", anonymousId: "anon-orga-001", properties: { source: "instagram.com" }, createdAt: daysAgo(41) },
    { name: "landing_viewed", anonymousId: "anon-other-01", properties: { source: "direct" }, createdAt: daysAgo(2) },
    { name: "app_opened", anonymousId: "anon-orga-001", userId: orga.id, workspaceId: workspace.id, createdAt: daysAgo(40) },
    { name: "budget_exported", userId: orga.id, workspaceId: workspace.id, eventId: first.id, createdAt: daysAgo(3) },
  ] });
  return `Bearer ${session.sessionToken}`;
}

describe("admin budget funnel", () => {
  it("follows each user through the AARRR budget funnel and attributes signups to their source", async () => {
    const authorization = await seedJourneys();
    const response = await request("GET", "/api/admin/funnel?period=all", authorization);
    assert.equal(response.statusCode, 200);
    const funnel = json<Funnel>(response);
    const steps = Object.fromEntries(funnel.steps.map((step) => [step.key, [step.users, step.eligible]]));
    assert.deepEqual(steps, {
      visited: [2, null], leadCaptured: [3, null], trialCompleted: [2, null], trialConverted: [1, null], signedUp: [2, null], verified: [1, null], eventCreated: [1, null], budgetOpened: [1, null],
      firstBudgetLine: [1, null], budgetComplete: [1, null], returnedLaterDay: [1, 1], active7d: [1, 1], active30d: [1, 1],
      invited: [1, null], inviteAccepted: [1, null], exported: [1, null], multiEvent: [1, null],
    });
    assert.equal(funnel.medianHoursToFirstBudgetLine, 2);
    assert.deepEqual(funnel.sources, [
      { source: "instagram.com", visitors: 1, signups: 1, activated: 1 },
      { source: "inconnue", visitors: 0, signups: 1, activated: 0 },
      { source: "direct", visitors: 1, signups: 0, activated: 0 },
    ]);
  });

  it("restricts the cohort to users and visits of the selected period", async () => {
    const authorization = await seedJourneys();
    const funnel = json<Funnel>(await request("GET", "/api/admin/funnel?period=30", authorization));
    const users = Object.fromEntries(funnel.steps.map((step) => [step.key, step.users]));
    assert.deepEqual([users.visited, users.leadCaptured, users.signedUp, users.verified], [1, 3, 1, 0]);
    assert.equal(funnel.steps.find((step) => step.key === "active7d")!.eligible, 0);
    assert.equal((await request("GET", "/api/admin/funnel?period=7", authorization)).statusCode, 400);
  });

  it("leaves out accounts created before tracking started", async () => {
    const authorization = await seedJourneys();
    await prisma.user.create({ data: { email: "legacy@abregi.test", createdAt: daysAgo(60), emailVerified: daysAgo(60) } });
    const funnel = json<Funnel>(await request("GET", "/api/admin/funnel?period=90", authorization));
    const users = Object.fromEntries(funnel.steps.map((step) => [step.key, step.users]));
    assert.deepEqual([users.signedUp, users.verified], [2, 1]);
  });
});
