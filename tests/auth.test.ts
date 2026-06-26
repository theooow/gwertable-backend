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
      service: "abregi-backend",
    });

    const loginLink = await request("POST", "/api/auth/login-link", undefined, {
      email: "Admin@Abregi.test",
    });
    assert.equal(loginLink.statusCode, 200);
    const loginPayload = json<{ email: string }>(loginLink);
    assert.equal(loginPayload.email, "admin@abregi.test");
    assert.doesNotMatch(loginLink.body, /token=/);

    const token = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: "admin@abregi.test" },
    });
    const verified = await request("POST", "/api/auth/verify", undefined, {
      email: "admin@abregi.test",
      token: token.token,
    });
    assert.equal(verified.statusCode, 200);
    const verifiedPayload = json<{
      requiresPasswordSetup: true;
      setupToken: string;
      email: string;
    }>(verified);
    assert.equal(verifiedPayload.email, "admin@abregi.test");
    assert.ok(verifiedPayload.setupToken);

    const passwordSetup = await request("POST", "/api/auth/password/setup", undefined, {
      email: "admin@abregi.test",
      token: verifiedPayload.setupToken,
      password: "correct-password",
    });
    assert.equal(passwordSetup.statusCode, 200);
    const passwordSetupPayload = json<{
      sessionToken: string;
      user: { email: string; role: string; workspaceId: string };
    }>(passwordSetup);
    assert.equal(passwordSetupPayload.user.email, "admin@abregi.test");
    assert.equal(passwordSetupPayload.user.role, "ADMIN");
    assert.ok(passwordSetupPayload.user.workspaceId);

    const me = await request("GET", "/api/auth/me", `Bearer ${passwordSetupPayload.sessionToken}`);
    assert.equal(me.statusCode, 200);
    assert.equal(json<{ user: { email: string } }>(me).user.email, "admin@abregi.test");

    const passwordLogin = await request("POST", "/api/auth/password/login", undefined, {
      email: "admin@abregi.test",
      password: "correct-password",
    });
    assert.equal(passwordLogin.statusCode, 200);

    const logout = await request("POST", "/api/auth/logout", `Bearer ${passwordSetupPayload.sessionToken}`);
    assert.equal(logout.statusCode, 200);
    assert.deepEqual(json(logout), { ok: true });
  });

  it("accepts a six-digit login code for users with a password", async () => {
    await request("POST", "/api/auth/login-link", undefined, {
      email: "code@abregi.test",
    });

    const token = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: "code@abregi.test" },
    });
    const verified = await request("POST", "/api/auth/verify", undefined, {
      email: "code@abregi.test",
      token: token.token,
    });
    const setup = json<{ setupToken: string }>(verified);
    await request("POST", "/api/auth/password/setup", undefined, {
      email: "code@abregi.test",
      token: setup.setupToken,
      password: "correct-password",
    });

    await request("POST", "/api/auth/login-link", undefined, {
      email: "code@abregi.test",
    });
    const codeToken = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: "code:code@abregi.test" },
    });
    assert.match(codeToken.token, /^\d{6}$/);

    const codeLogin = await request("POST", "/api/auth/verify-code", undefined, {
      email: "code@abregi.test",
      code: codeToken.token,
    });
    assert.equal(codeLogin.statusCode, 200);
    assert.ok(json<{ sessionToken: string }>(codeLogin).sessionToken);
  });

  it("requires authentication on protected routes", async () => {
    const response = await request("GET", "/api/events");
    assert.equal(response.statusCode, 401);
    assert.equal(json<{ error: string }>(response).error, "Unauthorized");
  });

  it("rejects expired magic links", async () => {
    await prisma.verificationToken.create({
      data: {
        identifier: "expired@abregi.test",
        token: "expired-token",
        expires: new Date(Date.now() - 60 * 1000),
      },
    });

    const verified = await request("POST", "/api/auth/verify", undefined, {
      email: "expired@abregi.test",
      token: "expired-token",
    });
    assert.equal(verified.statusCode, 401);
    assert.equal(await prisma.session.count(), 0);
    assert.equal(await prisma.verificationToken.count({ where: { token: "expired-token" } }), 0);
  });

  it("rejects magic links with an excessive stored expiration", async () => {
    await prisma.verificationToken.create({
      data: {
        identifier: "too-long@abregi.test",
        token: "too-long-token",
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const verified = await request("POST", "/api/auth/verify", undefined, {
      email: "too-long@abregi.test",
      token: "too-long-token",
    });
    assert.equal(verified.statusCode, 401);
    assert.equal(await prisma.session.count(), 0);
  });

  it("accepts a workspace invitation during magic-link login", async () => {
    const workspace = await prisma.workspace.create({ data: { name: "Inviting workspace" } });
    const admin = await prisma.user.create({
      data: {
        email: "owner@abregi.test",
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
      email: "collab@abregi.test",
      role: "ORGANIZER",
    });
    assert.equal(invitation.statusCode, 201);
    const invitePayload = json<{ inviteUrl: string }>(invitation);
    const inviteToken = new URL(invitePayload.inviteUrl).searchParams.get("invite");
    assert.ok(inviteToken);

    const loginLink = await request("POST", "/api/auth/login-link", undefined, {
      email: "collab@abregi.test",
      inviteToken,
    });
    assert.equal(loginLink.statusCode, 200);
    assert.doesNotMatch(loginLink.body, /invite=/);

    const verificationToken = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: "collab@abregi.test" },
    });
    const verified = await request("POST", "/api/auth/verify", undefined, {
      email: "collab@abregi.test",
      token: verificationToken.token,
      inviteToken,
    });
    assert.equal(verified.statusCode, 200);
    const verifiedPayload = json<{ setupToken: string }>(verified);

    const passwordSetup = await request("POST", "/api/auth/password/setup", undefined, {
      email: "collab@abregi.test",
      token: verifiedPayload.setupToken,
      password: "correct-password",
    });
    assert.equal(passwordSetup.statusCode, 200);
    const passwordSetupPayload = json<{ user: { role: string; workspaceId: string } }>(passwordSetup);
    assert.equal(passwordSetupPayload.user.role, "ORGANIZER");
    assert.equal(passwordSetupPayload.user.workspaceId, workspace.id);

    const member = await prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId: workspace.id, user: { email: "collab@abregi.test" } },
    });
    assert.equal(member.role, "ORGANIZER");

    const acceptedInvitation = await prisma.workspaceInvitation.findFirstOrThrow({
      where: { token: inviteToken },
    });
    assert.ok(acceptedInvitation.acceptedAt);
  });

  it("accepts a workspace invitation for an already signed-in user", async () => {
    const ownWorkspace = await prisma.workspace.create({ data: { name: "Own workspace" } });
    const invitedUser = await prisma.user.create({
      data: {
        email: "existing@abregi.test",
        role: "ADMIN",
        defaultWorkspaceId: ownWorkspace.id,
        workspaceMemberships: {
          create: { workspaceId: ownWorkspace.id, role: "ADMIN" },
        },
        sessions: {
          create: {
            sessionToken: "existing-session",
            expires: new Date(Date.now() + 60 * 60 * 1000),
          },
        },
      },
    });
    const invitingWorkspace = await prisma.workspace.create({ data: { name: "Inviting workspace" } });
    await prisma.workspaceInvitation.create({
      data: {
        workspaceId: invitingWorkspace.id,
        email: invitedUser.email,
        role: "ORGANIZER",
        token: "existing-invite-token",
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const accepted = await request("POST", "/api/workspace/invitations/accept", "Bearer existing-session", {
      inviteToken: "existing-invite-token",
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: invitedUser.id } })).defaultWorkspaceId,
      invitingWorkspace.id,
    );

    const member = await prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId: invitingWorkspace.id, userId: invitedUser.id },
    });
    assert.equal(member.role, "ORGANIZER");
  });
});
