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
      email: "collab@abregi.test",
      role: "VOLUNTEER",
    });
    assert.equal(invitation.statusCode, 201);
    const invitationPayload = json<{ email: string; role: string; inviteUrl: string }>(invitation);
    assert.equal(invitationPayload.email, "collab@abregi.test");
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
    assert.equal(membersPayload.invitations[0].email, "collab@abregi.test");
  });

  it("lists invited events available to the current user", async () => {
    const { authorization, user, workspace } = await seedAdminSession();
    const invitedWorkspace = await prisma.workspace.create({
      data: {
        name: "Invited workspace",
        members: {
          create: {
            userId: user.id,
            role: "ORGANIZER",
          },
        },
      },
    });
    const invitedEvent = await prisma.event.create({
      data: {
        workspaceId: invitedWorkspace.id,
        name: "Invited event",
        startsAt: new Date("2026-08-12T19:00:00.000Z"),
      },
    });
    await prisma.eventCollaborator.create({
      data: {
        workspaceId: invitedWorkspace.id,
        eventId: invitedEvent.id,
        email: user.email,
        userId: user.id,
        role: "ORGANIZER",
        token: "invite-token",
        expires: new Date(Date.now() + 60 * 60 * 1000),
        acceptedAt: new Date(),
      },
    });

    const response = await request("GET", "/api/workspace/invited-events", authorization);
    assert.equal(response.statusCode, 200);
    const payload = json<{
      events: {
        eventId: string;
        eventName: string;
        workspaceId: string;
        workspaceName: string;
        role: string;
      }[];
    }>(response);

    assert.equal(payload.events.length, 1);
    assert.equal(payload.events[0]!.eventId, invitedEvent.id);
    assert.equal(payload.events[0]!.eventName, "Invited event");
    assert.equal(payload.events[0]!.workspaceId, invitedWorkspace.id);
    assert.equal(payload.events[0]!.workspaceName, invitedWorkspace.name);
    assert.equal(payload.events[0]!.role, "ORGANIZER");
    assert.notEqual(payload.events[0]!.workspaceId, workspace.id);
  });

  it("updates account and workspace settings", async () => {
    const { authorization } = await seedAdminSession();

    const account = await request("PUT", "/api/account", authorization, {
      name: "Theo Selim",
    });
    assert.equal(account.statusCode, 200);
    assert.equal(json<{ user: { name: string } }>(account).user.name, "Theo Selim");

    const workspace = await request("PUT", "/api/workspace", authorization, {
      name: "Abregi Prod",
    });
    assert.equal(workspace.statusCode, 200);
    assert.equal(json<{ workspace: { name: string } }>(workspace).workspace.name, "Abregi Prod");
  });

  it("lists, creates and switches user workspaces", async () => {
    const { authorization, workspace, user } = await seedAdminSession();

    const listed = await request("GET", "/api/workspaces", authorization);
    assert.equal(listed.statusCode, 200);
    const initialPayload = json<{
      workspaces: { id: string; name: string; role: string; current: boolean }[];
    }>(listed);
    assert.equal(initialPayload.workspaces.length, 1);
    assert.equal(initialPayload.workspaces[0]!.id, workspace.id);
    assert.equal(initialPayload.workspaces[0]!.name, workspace.name);
    assert.equal(initialPayload.workspaces[0]!.role, "ADMIN");
    assert.equal(initialPayload.workspaces[0]!.current, true);

    const created = await request("POST", "/api/workspaces", authorization, {
      name: "Nouveau collectif",
    });
    assert.equal(created.statusCode, 201);
    const createdWorkspace = json<{ workspace: { id: string; name: string } }>(created).workspace;
    assert.equal(createdWorkspace.name, "Nouveau collectif");
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).defaultWorkspaceId,
      createdWorkspace.id,
    );

    const switched = await request("PUT", "/api/account/workspace", authorization, {
      workspaceId: workspace.id,
    });
    assert.equal(switched.statusCode, 200);
    const switchedPayload = json<{ user: { workspaceId: string; workspaceName: string; role: string } }>(switched);
    assert.equal(switchedPayload.user.workspaceId, workspace.id);
    assert.equal(switchedPayload.user.workspaceName, workspace.name);
    assert.equal(switchedPayload.user.role, "ADMIN");
  });

  it("updates and removes workspace members", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const memberUser = await prisma.user.create({
      data: {
        email: "member@abregi.test",
        role: "VIEWER",
        defaultWorkspaceId: workspace.id,
        workspaceMemberships: {
          create: { workspaceId: workspace.id, role: "VIEWER" },
        },
      },
      include: { workspaceMemberships: true },
    });
    const memberId = memberUser.workspaceMemberships[0]!.id;

    const updated = await request("PUT", `/api/workspace/members/${memberId}`, authorization, {
      role: "ORGANIZER",
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(json<{ role: string }>(updated).role, "ORGANIZER");

    const removed = await request("DELETE", `/api/workspace/members/${memberId}`, authorization);
    assert.equal(removed.statusCode, 200);
    assert.deepEqual(json(removed), { ok: true });
    assert.equal(await prisma.workspaceMember.count({ where: { id: memberId } }), 0);
  });

  it("keeps at least one workspace admin", async () => {
    const { authorization } = await seedAdminSession();
    const members = await request("GET", "/api/workspace/members", authorization);
    const adminMember = json<{ members: { id: string }[] }>(members).members[0]!;

    const demote = await request("PUT", `/api/workspace/members/${adminMember.id}`, authorization, {
      role: "VIEWER",
    });
    assert.equal(demote.statusCode, 400);

    const remove = await request("DELETE", `/api/workspace/members/${adminMember.id}`, authorization);
    assert.equal(remove.statusCode, 400);
  });

  it("clears the current workspace after confirmation when it is the user's last workspace", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const person = await prisma.person.create({
      data: {
        workspaceId: workspace.id,
        fullName: "Workspace Contact",
      },
    });
    await prisma.event.create({
      data: {
        workspaceId: workspace.id,
        name: "Workspace Event",
        startsAt: new Date("2026-07-01T18:00:00.000Z"),
      },
    });
    await prisma.equipmentItem.create({
      data: {
        workspaceId: workspace.id,
        name: "Console",
        category: "son",
        ownership: "OWNED",
        ownerId: person.id,
      },
    });

    const blocked = await request("DELETE", "/api/workspace", authorization, {
      confirm: "wrong",
    });
    assert.equal(blocked.statusCode, 400);

    const deleted = await request("DELETE", "/api/workspace", authorization, {
      confirm: workspace.name,
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(json(deleted), { ok: true, deletedWorkspace: false });
    assert.equal(await prisma.workspace.count({ where: { id: workspace.id } }), 1);
    assert.equal(await prisma.event.count({ where: { workspaceId: workspace.id } }), 0);
    assert.equal(await prisma.person.count({ where: { workspaceId: workspace.id } }), 0);
    assert.equal(await prisma.equipmentItem.count({ where: { workspaceId: workspace.id } }), 0);
  });

  it("deletes the current workspace and switches to another workspace when available", async () => {
    const { authorization, workspace, user } = await seedAdminSession();
    const fallbackWorkspace = await prisma.workspace.create({
      data: {
        name: "Fallback workspace",
        members: {
          create: {
            userId: user.id,
            role: "ADMIN",
          },
        },
      },
    });

    const deleted = await request("DELETE", "/api/workspace", authorization, {
      confirm: workspace.name,
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(json(deleted), { ok: true, deletedWorkspace: true });
    assert.equal(await prisma.workspace.count({ where: { id: workspace.id } }), 0);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).defaultWorkspaceId,
      fallbackWorkspace.id,
    );
  });

  it("deletes the current account after email confirmation", async () => {
    const { authorization, user } = await seedAdminSession();

    const blocked = await request("DELETE", "/api/account", authorization, {
      confirm: "wrong@abregi.test",
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
        email: "viewer@abregi.test",
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
    assert.equal(user.email, "viewer@abregi.test");

    const response = await request("POST", "/api/workspace/invitations", "Bearer viewer-session", {
      email: "blocked@abregi.test",
      role: "VIEWER",
    });
    assert.equal(response.statusCode, 403);
  });
});
