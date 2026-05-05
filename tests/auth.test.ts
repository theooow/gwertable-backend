import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "../src/prisma.js";
import { json, request, setupTestApp } from "./helpers.js";

setupTestApp();

describe("auth and health routes", () => {
  it("exposes public health and auth routes", async () => {
    const health = await request("GET", "/health");
    assert.equal(health.statusCode, 200);
    assert.deepEqual(json(health), {
      status: "ok",
      service: "gwertable-backend",
    });

    const loginLink = await request("POST", "/api/auth/login-link", undefined, {
      email: "Admin@Gwertable.test",
    });
    assert.equal(loginLink.statusCode, 200);
    const loginPayload = json<{ email: string; devVerificationUrl: string }>(loginLink);
    assert.equal(loginPayload.email, "admin@gwertable.test");
    assert.match(loginPayload.devVerificationUrl, /token=/);

    const token = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: "admin@gwertable.test" },
    });
    const verified = await request("POST", "/api/auth/verify", undefined, {
      email: "admin@gwertable.test",
      token: token.token,
    });
    assert.equal(verified.statusCode, 200);
    const verifiedPayload = json<{
      sessionToken: string;
      user: { email: string; role: string; workspaceId: string };
    }>(verified);
    assert.equal(verifiedPayload.user.email, "admin@gwertable.test");
    assert.equal(verifiedPayload.user.role, "ADMIN");
    assert.ok(verifiedPayload.user.workspaceId);

    const me = await request("GET", "/api/auth/me", `Bearer ${verifiedPayload.sessionToken}`);
    assert.equal(me.statusCode, 200);
    assert.equal(json<{ user: { email: string } }>(me).user.email, "admin@gwertable.test");

    const logout = await request("POST", "/api/auth/logout", `Bearer ${verifiedPayload.sessionToken}`);
    assert.equal(logout.statusCode, 200);
    assert.deepEqual(json(logout), { ok: true });
  });

  it("requires authentication on protected routes", async () => {
    const response = await request("GET", "/api/events");
    assert.equal(response.statusCode, 401);
    assert.equal(json<{ error: string }>(response).error, "Unauthorized");
  });

  it("accepts a workspace invitation during magic-link login", async () => {
    const workspace = await prisma.workspace.create({ data: { name: "Inviting workspace" } });
    const admin = await prisma.user.create({
      data: {
        email: "owner@gwertable.test",
        role: "ADMIN",
        defaultWorkspaceId: workspace.id,
        workspaceMemberships: {
          create: { workspaceId: workspace.id, role: "ADMIN" },
        },
      },
    });
    await prisma.session.create({
      data: {
        sessionToken: "owner-session",
        userId: admin.id,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const invitation = await request("POST", "/api/workspace/invitations", "Bearer owner-session", {
      email: "collab@gwertable.test",
      role: "ORGANIZER",
    });
    assert.equal(invitation.statusCode, 201);
    const invitePayload = json<{ inviteUrl: string }>(invitation);
    const inviteToken = new URL(invitePayload.inviteUrl).searchParams.get("invite");
    assert.ok(inviteToken);

    const loginLink = await request("POST", "/api/auth/login-link", undefined, {
      email: "collab@gwertable.test",
      inviteToken,
    });
    assert.equal(loginLink.statusCode, 200);
    assert.match(json<{ devVerificationUrl: string }>(loginLink).devVerificationUrl, /invite=/);

    const verificationToken = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: "collab@gwertable.test" },
    });
    const verified = await request("POST", "/api/auth/verify", undefined, {
      email: "collab@gwertable.test",
      token: verificationToken.token,
      inviteToken,
    });
    assert.equal(verified.statusCode, 200);
    const verifiedPayload = json<{ user: { role: string; workspaceId: string } }>(verified);
    assert.equal(verifiedPayload.user.role, "ORGANIZER");
    assert.equal(verifiedPayload.user.workspaceId, workspace.id);

    const member = await prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId: workspace.id, user: { email: "collab@gwertable.test" } },
    });
    assert.equal(member.role, "ORGANIZER");

    const acceptedInvitation = await prisma.workspaceInvitation.findFirstOrThrow({
      where: { token: inviteToken },
    });
    assert.ok(acceptedInvitation.acceptedAt);
  });
});
