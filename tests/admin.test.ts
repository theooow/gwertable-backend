import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, setupTestApp, seedAdminSession } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

describe("admin routes", () => {
  it("rejects anonymous access and workspace admins for all journal endpoints", async () => {
    const { authorization } = await seedAdminSession();
    for (const path of ["/api/admin/overview", "/api/admin/kpis", "/api/admin/logs", "/api/admin/logs/missing"]) {
      assert.equal((await request("GET", path)).statusCode, 401);
      assert.equal((await request("GET", path, authorization)).statusCode, 403);
    }
  });
  it("lists users with usage plans and updates a user plan", async () => {
    const workspace = await prisma.workspace.create({ data: { name: "Admin workspace" } });
    const owner = await prisma.user.create({
      data: {
        email: "theooow@hotmail.com",
        role: "ADMIN",
        defaultWorkspaceId: workspace.id,
        workspaceMemberships: { create: { workspaceId: workspace.id, role: "ADMIN" } },
      },
    });
    const target = await prisma.user.create({
      data: {
        email: "orga@abregi.test",
        role: "ADMIN",
        defaultWorkspaceId: workspace.id,
        workspaceMemberships: { create: { workspaceId: workspace.id, role: "ADMIN" } },
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: "owner-admin-session",
        userId: owner.id,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const authorization = `Bearer ${session.sessionToken}`;

    const overview = await request("GET", "/api/admin/overview", authorization);
    assert.equal(overview.statusCode, 200);
    const overviewPayload = json<{ users: Array<{ id: string; usagePlan: string }> }>(overview);
    assert.equal(overviewPayload.users.find((user) => user.id === target.id)?.usagePlan, "BETA_TEST");

    const updated = await request("PATCH", `/api/admin/users/${target.id}/plan`, authorization, {
      usagePlan: "PLATINIUM",
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(json<{ user: { usagePlan: string } }>(updated).user.usagePlan, "PLATINIUM");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).usagePlan, "PLATINIUM");

    const list = await request("GET", "/api/admin/logs?activity=true&limit=1", authorization);
    assert.equal(list.statusCode, 200);
    assert.equal(list.headers["cache-control"], "no-store");
    const logs = json<{ logs: Array<{ id: string; action: string; userId: string }> }>(list).logs;
    assert.equal(logs[0].userId, owner.id);
    assert.equal(logs[0].action, "Forfait modifié");
    const detail = await request("GET", `/api/admin/logs/${logs[0].id}`, authorization);
    assert.equal(detail.statusCode, 200);
    assert.equal(json<{ requestBody: { usagePlan: string } }>(detail).requestBody.usagePlan, "PLATINIUM");
    assert.equal((await request("GET", "/api/admin/logs?limit=1000", authorization)).statusCode, 400);
    assert.equal((await request("GET", "/api/admin/logs/missing", authorization)).statusCode, 404);
  });
  it("reports budgeted events per workspace and module adoption", async () => {
    const workspace = await prisma.workspace.create({ data: { name: "Asso budget" } });
    await prisma.workspace.create({ data: { name: "Asso vide" } });
    const owner = await prisma.user.create({
      data: { email: "theooow@hotmail.com", role: "ADMIN", defaultWorkspaceId: workspace.id, workspaceMemberships: { create: { workspaceId: workspace.id, role: "ADMIN" } } },
    });
    const session = await prisma.session.create({ data: { sessionToken: "owner-kpi-session", userId: owner.id, expires: new Date(Date.now() + 3600000) } });
    const startsAt = new Date(Date.now() + 7 * 86400000);
    await prisma.event.create({ data: { workspaceId: workspace.id, name: "Budgété", startsAt, expenses: { create: { label: "Son", amountCents: 1000, category: "SON" } } } });
    await prisma.event.create({ data: { workspaceId: workspace.id, name: "Billetterie", startsAt, ticketTiers: { create: { name: "Prévente", organizerRevenueCents: 900, publicPriceCents: 1000, quantity: 100 } } } });
    await prisma.event.create({ data: { workspaceId: workspace.id, name: "Auto", startsAt: new Date(Date.now() - 7 * 86400000), expenses: { create: { label: "Matériel", amountCents: 500, category: "MATERIEL", isEquipmentSync: true } } } });

    const response = await request("GET", "/api/admin/kpis", `Bearer ${session.sessionToken}`);
    assert.equal(response.statusCode, 200);
    const kpis = json<{
      totals: { events: number; budgetedEvents: number; workspaces: number; workspacesWithBudget: number };
      adoption: Array<{ module: string; events: number }>;
      monthly: Array<{ events: number }>;
      workspaces: Array<{ name: string; events: number; budgetedEvents: number; upcomingEvents: number; members: number }>;
    }>(response);
    assert.deepEqual([kpis.totals.events, kpis.totals.budgetedEvents, kpis.totals.workspaces, kpis.totals.workspacesWithBudget], [3, 2, 2, 1]);
    assert.equal(kpis.adoption.find((row) => row.module === "ticketing")?.events, 1);
    assert.equal(kpis.monthly.length, 6);
    assert.equal(kpis.monthly.at(-1)?.events, 3);
    assert.deepEqual(kpis.workspaces[0], { ...kpis.workspaces[0], name: "Asso budget", events: 3, budgetedEvents: 2, upcomingEvents: 2, members: 1 });
  });
});
