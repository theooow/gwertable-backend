import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);

type Lead = { email: string; trials: number; eventName: string | null; trialCompleted: boolean; unsubscribed: boolean; firstTriedAt: string; lastTriedAt: string };

describe("admin budget leads", () => {
  it("lists trial emails that never became an account, one row per person", async () => {
    await seedAdminSession();
    const admin = await prisma.user.create({ data: { email: "theooow@hotmail.com" } });
    await prisma.session.create({ data: { sessionToken: "leads-admin", userId: admin.id, expires: new Date(Date.now() + 3600000) } });
    await prisma.user.create({ data: { email: "Signed@abregi.test" } });
    await prisma.budgetLead.createMany({ data: [
      { email: "curious@abregi.test", token: "lead-a-0000000000", createdAt: daysAgo(5) },
      { email: "Curious@abregi.test", token: "lead-b-0000000000", createdAt: daysAgo(1), trialCompletedAt: daysAgo(1), trial: { eventName: "Soirée de rentrée" }, unsubscribedAt: daysAgo(1) },
      { email: "bounce@abregi.test", token: "lead-c-0000000000", createdAt: daysAgo(3) },
      { email: "claimed@abregi.test", token: "lead-d-0000000000", convertedAt: daysAgo(2) },
      { email: "claimed@abregi.test", token: "lead-e-0000000000" },
      { email: "signed@abregi.test", token: "lead-f-0000000000" },
    ] });

    const response = await request("GET", "/api/admin/budget-leads", "Bearer leads-admin");
    assert.equal(response.statusCode, 200);
    const { leads } = json<{ leads: Lead[] }>(response);
    assert.deepEqual(leads.map(({ email, trials, eventName, trialCompleted, unsubscribed }) => ({ email, trials, eventName, trialCompleted, unsubscribed })), [
      { email: "Curious@abregi.test", trials: 2, eventName: "Soirée de rentrée", trialCompleted: true, unsubscribed: true },
      { email: "bounce@abregi.test", trials: 1, eventName: null, trialCompleted: false, unsubscribed: false },
    ]);
    assert.ok(new Date(leads[0].firstTriedAt) < new Date(leads[0].lastTriedAt));
  });

  it("is reserved to the platform administrator", async () => {
    const { authorization } = await seedAdminSession();
    assert.equal((await request("GET", "/api/admin/budget-leads", authorization)).statusCode, 403);
  });
});
