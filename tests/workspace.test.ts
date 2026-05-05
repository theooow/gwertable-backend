import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "../src/prisma.js";
import { json, request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();

describe("workspace routes", () => {
  it("lists members and creates pending invitations", async () => {
    const { authorization, workspace } = await seedAdminSession();

    const workspaceResponse = await request("GET", "/api/workspace", authorization);
    assert.equal(workspaceResponse.statusCode, 200);
    assert.equal(json<{ workspace: { id: string } }>(workspaceResponse).workspace.id, workspace.id);

    const invitation = await request("POST", "/api/workspace/invitations", authorization, {
      email: "collab@gwertable.test",
      role: "VOLUNTEER",
    });
    assert.equal(invitation.statusCode, 201);
    const invitationPayload = json<{ email: string; role: string; inviteUrl: string }>(invitation);
    assert.equal(invitationPayload.email, "collab@gwertable.test");
    assert.equal(invitationPayload.role, "VOLUNTEER");
    assert.match(invitationPayload.inviteUrl, /invite=/);

    const members = await request("GET", "/api/workspace/members", authorization);
    assert.equal(members.statusCode, 200);
    const membersPayload = json<{
      members: unknown[];
      invitations: { email: string; role: string; inviteUrl: string }[];
    }>(members);
    assert.equal(membersPayload.members.length, 1);
    assert.equal(membersPayload.invitations.length, 1);
    assert.equal(membersPayload.invitations[0].email, "collab@gwertable.test");
  });

  it("updates account and workspace settings", async () => {
    const { authorization } = await seedAdminSession();

    const account = await request("PUT", "/api/account", authorization, {
      name: "Theo Selim",
    });
    assert.equal(account.statusCode, 200);
    assert.equal(json<{ user: { name: string } }>(account).user.name, "Theo Selim");

    const workspace = await request("PUT", "/api/workspace", authorization, {
      name: "Gwertable Prod",
    });
    assert.equal(workspace.statusCode, 200);
    assert.equal(json<{ workspace: { name: string } }>(workspace).workspace.name, "Gwertable Prod");
  });

  it("deletes the current workspace after confirmation", async () => {
    const { authorization, workspace } = await seedAdminSession();

    const blocked = await request("DELETE", "/api/workspace", authorization, {
      confirm: "wrong",
    });
    assert.equal(blocked.statusCode, 400);

    const deleted = await request("DELETE", "/api/workspace", authorization, {
      confirm: workspace.name,
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(json(deleted), { ok: true });
    assert.equal(await prisma.workspace.count({ where: { id: workspace.id } }), 0);
  });

  it("deletes the current account after email confirmation", async () => {
    const { authorization, user } = await seedAdminSession();

    const blocked = await request("DELETE", "/api/account", authorization, {
      confirm: "wrong@gwertable.test",
    });
    assert.equal(blocked.statusCode, 400);

    const deleted = await request("DELETE", "/api/account", authorization, {
      confirm: user.email,
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(json(deleted), { ok: true });
    assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
  });

  it("forbids non-admin users from managing invitations", async () => {
    const { workspace } = await seedAdminSession();
    const user = await prisma.user.create({
      data: {
        email: "viewer@gwertable.test",
        role: "VIEWER",
        defaultWorkspaceId: workspace.id,
        workspaceMemberships: {
          create: { workspaceId: workspace.id, role: "VIEWER" },
        },
        sessions: {
          create: {
            sessionToken: "viewer-session",
            expires: new Date(Date.now() + 60 * 60 * 1000),
          },
        },
      },
    });
    assert.equal(user.email, "viewer@gwertable.test");

    const response = await request("POST", "/api/workspace/invitations", "Bearer viewer-session", {
      email: "blocked@gwertable.test",
      role: "VIEWER",
    });
    assert.equal(response.statusCode, 403);
  });
});
