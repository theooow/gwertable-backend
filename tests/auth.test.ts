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
      requiresRegistrationSetup: true;
      registrationToken: string;
      email: string;
    }>(verified);
    assert.equal(verifiedPayload.email, "admin@abregi.test");
    assert.ok(verifiedPayload.registrationToken);

    const passwordSetup = await request("POST", "/api/auth/register", undefined, {
      email: "admin@abregi.test",
      registrationToken: verifiedPayload.registrationToken,
      password: "correct-password",
      firstName: "Admin",
      lastName: "Abregi",
    });
    assert.equal(passwordSetup.statusCode, 201);
    const passwordSetupPayload = json<{
      sessionToken: string;
      user: { email: string; role: string; workspaceId: string };
    }>(passwordSetup);
    assert.equal(passwordSetupPayload.user.email, "admin@abregi.test");
    assert.equal(passwordSetupPayload.user.role, "ADMIN");
    assert.ok(passwordSetupPayload.user.workspaceId);

    const createdAccount = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@abregi.test" },
      include: { workspaceMemberships: true },
    });
    assert.equal(createdAccount.role, "VIEWER");
    assert.equal(createdAccount.workspaceMemberships.length, 1);
    assert.equal(createdAccount.workspaceMemberships[0]?.role, "ADMIN");

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
    const setup = json<{ registrationToken: string }>(verified);
    await request("POST", "/api/auth/register", undefined, {
      email: "code@abregi.test",
      registrationToken: setup.registrationToken,
      password: "correct-password",
      firstName: "Code",
      lastName: "User",
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

  it("shows registration for unknown emails and creates a complete account", async () => {
    const options = await request("POST", "/api/auth/login-options", undefined, {
      email: "new-user@abregi.test",
    });
    assert.equal(options.statusCode, 200);
    assert.deepEqual(json(options), {
      ok: true,
      email: "new-user@abregi.test",
      hasPassword: false,
      codeSent: true,
    });
    const verificationToken = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: "new-user@abregi.test" },
    });
    const verified = await request("POST", "/api/auth/verify", undefined, {
      email: "new-user@abregi.test",
      token: verificationToken.token,
    });
    assert.equal(verified.statusCode, 200);
    const registration = json<{ registrationToken: string }>(verified);

    const registered = await request("POST", "/api/auth/register", undefined, {
      email: "new-user@abregi.test",
      registrationToken: registration.registrationToken,
      password: "correct-password",
      firstName: "Nora",
      lastName: "Martin",
      name: "Nora M.",
      phone: "0600000000",
      addressLine1: "1 rue du Test",
      postalCode: "75010",
      city: "Paris",
      country: "France",
      companyName: "Nora Events",
      companySiret: "12345678900012",
      billingEmail: "billing@abregi.test",
      locale: "fr-FR",
      currency: "EUR",
      timezone: "Europe/Paris",
    });
    assert.equal(registered.statusCode, 201);
    const payload = json<{
      sessionToken: string;
      user: {
        email: string;
        firstName: string;
        companyName: string;
        billingEmail: string;
        workspaceName: string;
        role: string;
      };
    }>(registered);
    assert.ok(payload.sessionToken);
    assert.equal(payload.user.email, "new-user@abregi.test");
    assert.equal(payload.user.firstName, "Nora");
    assert.equal(payload.user.companyName, "Nora Events");
    assert.equal(payload.user.billingEmail, "billing@abregi.test");
    assert.equal(payload.user.workspaceName, "Nora Events");
    assert.equal(payload.user.role, "ADMIN");

    const additionalWorkspace = await request("POST", "/api/workspaces", `Bearer ${payload.sessionToken}`, {
      name: "Deuxieme espace",
    });
    assert.equal(additionalWorkspace.statusCode, 201);
    const additionalWorkspacePayload = json<{ workspace: { id: string } }>(additionalWorkspace);
    const ownerMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: additionalWorkspacePayload.workspace.id,
          userId: (await prisma.user.findUniqueOrThrow({ where: { email: "new-user@abregi.test" } })).id,
        },
      },
    });
    assert.equal(ownerMembership?.role, "ADMIN");

    const me = await request("GET", "/api/auth/me", `Bearer ${payload.sessionToken}`);
    assert.equal(me.statusCode, 200);
    assert.equal(json<{ user: { email: string } }>(me).user.email, "new-user@abregi.test");
  });

  it("shows registration for incomplete magic-link accounts", async () => {
    await request("POST", "/api/auth/login-link", undefined, {
      email: "partial@abregi.test",
    });
    const token = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: "partial@abregi.test" },
    });
    const verified = await request("POST", "/api/auth/verify", undefined, {
      email: "partial@abregi.test",
      token: token.token,
    });
    assert.equal(verified.statusCode, 200);
    assert.ok(json<{ registrationToken: string }>(verified).registrationToken);

    const options = await request("POST", "/api/auth/login-options", undefined, {
      email: "partial@abregi.test",
    });
    assert.equal(options.statusCode, 200);
    assert.deepEqual(json(options), {
      ok: true,
      email: "partial@abregi.test",
      hasPassword: false,
      codeSent: true,
    });
    const code = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: "code:partial@abregi.test" },
    });
    const codeVerified = await request("POST", "/api/auth/verify-code", undefined, {
      email: "partial@abregi.test",
      code: code.token,
    });
    assert.equal(codeVerified.statusCode, 200);
    const registration = json<{ registrationToken: string }>(codeVerified);

    const registered = await request("POST", "/api/auth/register", undefined, {
      email: "partial@abregi.test",
      registrationToken: registration.registrationToken,
      password: "correct-password",
      firstName: "Paul",
      lastName: "Durand",
      companyName: "Partial Events",
      billingEmail: "partial-billing@abregi.test",
    });
    assert.equal(registered.statusCode, 201);
    const payload = json<{
      sessionToken: string;
      user: { email: string; firstName: string; companyName: string; billingEmail: string };
    }>(registered);
    assert.ok(payload.sessionToken);
    assert.equal(payload.user.email, "partial@abregi.test");
    assert.equal(payload.user.firstName, "Paul");
    assert.equal(payload.user.companyName, "Partial Events");
    assert.equal(payload.user.billingEmail, "partial-billing@abregi.test");
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
    const verifiedPayload = json<{ registrationToken: string }>(verified);

    const passwordSetup = await request("POST", "/api/auth/register", undefined, {
      email: "collab@abregi.test",
      registrationToken: verifiedPayload.registrationToken,
      password: "correct-password",
      firstName: "Collab",
      lastName: "Invited",
      inviteToken,
    });
    assert.equal(passwordSetup.statusCode, 201);
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
