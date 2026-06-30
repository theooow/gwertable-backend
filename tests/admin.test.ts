import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

describe("admin routes", () => {
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
  });
});
