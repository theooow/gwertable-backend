import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
setupTestApp();

const me = async (authorization: string) => json<{ user: { requiresSubscription: boolean } }>(await request("GET", "/api/auth/me", authorization)).user.requiresSubscription;

describe("subscription gate", () => {
  it("requires a plan unless someone in the workspace already has one", async () => {
    const { authorization, workspace } = await seedAdminSession("NONE");
    assert.equal(await me(authorization), true);

    const collaborator = await prisma.user.create({ data: { email: "colleague@abregi.test", defaultWorkspaceId: workspace.id, workspaceMemberships: { create: { workspaceId: workspace.id, role: "ORGANIZER" } } } });
    await prisma.session.create({ data: { sessionToken: "colleague-session", userId: collaborator.id, expires: new Date(Date.now() + 3600_000) } });
    assert.equal(await me("Bearer colleague-session"), true);

    await prisma.user.updateMany({ where: { email: "admin@abregi.test" }, data: { usagePlan: "LITE" } });
    assert.equal(await me(authorization), false);
    assert.equal(await me("Bearer colleague-session"), false);
  });
});
