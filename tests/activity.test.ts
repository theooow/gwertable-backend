import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UserRole } from "@prisma/client";
import { eventPayload, json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

type Feed = {
  activities: { id: string; type: string; title: string; category: string | null; eventId: string | null }[];
  notifications: { id: string; type: string; readAt: string | null }[];
  unreadCount: number;
  nextCursor: string | null;
  preferences: { equipmentChangesEnabled: boolean; volunteerChangesEnabled: boolean };
};

async function seedUser(workspaceId: string, email: string, membership: { role: UserRole } | null) {
  const user = await prisma.user.create({
    data: {
      email,
      defaultWorkspaceId: workspaceId,
      ...(membership ? { workspaceMemberships: { create: { workspaceId, role: membership.role } } } : {}),
    },
  });
  const session = await prisma.session.create({
    data: { sessionToken: `session-${email}`, userId: user.id, expires: new Date(Date.now() + 60 * 60 * 1000) },
  });
  return { user, authorization: `Bearer ${session.sessionToken}` };
}

async function feed(authorization: string, query = "") {
  const response = await request("GET", `/api/activity${query}`, authorization);
  assert.equal(response.statusCode, 200, response.body);
  return json<Feed>(response);
}

describe("activity feed", () => {
  it("hides activity a role is not allowed to read", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);
    const viewer = await seedUser(workspace.id, "viewer@abregi.test", { role: "VIEWER" });

    const expense = await request("POST", `/api/events/${event.id}/expenses`, authorization, {
      label: "Location son", amount: "120.00", category: "Technique",
    });
    assert.equal(expense.statusCode, 201, expense.body);

    const adminFeed = await feed(authorization);
    assert.ok(adminFeed.activities.some((entry) => entry.type === "EXPENSE_CREATED" && entry.category === "budget"));
    assert.ok(adminFeed.activities.some((entry) => entry.type === "PERSON_CREATED" && entry.category === "people"));

    const viewerFeed = await feed(viewer.authorization);
    assert.ok(viewerFeed.activities.some((entry) => entry.type === "EVENT_CREATED"));
    assert.ok(!viewerFeed.activities.some((entry) => entry.category === "budget" || entry.category === "people"));
    assert.ok(!viewerFeed.notifications.some((notification) => notification.type === "EXPENSE_CREATED"));
  });

  it("limits event collaborators to the events they were invited to", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);
    const other = json<{ id: string }>(await request("POST", "/api/events", authorization, { ...eventPayload, name: "Private party" }));
    const collaborator = await seedUser(workspace.id, "guest@abregi.test", null);
    await prisma.eventCollaborator.create({
      data: {
        eventId: event.id, workspaceId: workspace.id, email: "guest@abregi.test", userId: collaborator.user.id,
        role: "ORGANIZER", token: "guest-token", expires: new Date(Date.now() + 60_000), acceptedAt: new Date(),
      },
    });

    const guestFeed = await feed(collaborator.authorization);
    assert.ok(guestFeed.activities.length > 0);
    assert.ok(guestFeed.activities.every((entry) => entry.eventId === event.id));
    assert.ok(!guestFeed.activities.some((entry) => entry.eventId === other.id));
  });

  it("records equipment changes and honours the equipment preference", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);
    const organizer = await seedUser(workspace.id, "orga@abregi.test", { role: "ORGANIZER" });

    const created = await request("POST", `/api/events/${event.id}/equipment`, authorization, {
      kind: "oneoff", name: "Console DJ", category: "Son", quantity: 2,
      unitPriceCents: 5000, amountInputMode: "HT", vatRateBasisPoints: 2000, rentalCoef: 1,
    });
    assert.equal(created.statusCode, 201, created.body);

    const organizerFeed = await feed(organizer.authorization, "?category=equipment");
    assert.deepEqual(organizerFeed.activities.map((entry) => entry.title), ["Matériel ajouté : Console DJ"]);
    assert.equal(organizerFeed.notifications.filter((notification) => notification.type === "EQUIPMENT_ADDED").length, 1);
    assert.equal(organizerFeed.preferences.equipmentChangesEnabled, true);

    const preferences = await request("PUT", "/api/activity/preferences", organizer.authorization, {
      taskCommentsEnabled: true, budgetChangesEnabled: true, taskDueSoonEnabled: true, taskDueSoonMinutes: 1440,
      equipmentChangesEnabled: false,
    });
    assert.equal(preferences.statusCode, 200, preferences.body);

    const usage = json<{ id: string }>(created);
    const removed = await request("DELETE", `/api/events/${event.id}/equipment/${usage.id}`, authorization);
    assert.equal(removed.statusCode, 200, removed.body);

    const afterOptOut = await feed(organizer.authorization, "?category=equipment");
    assert.ok(afterOptOut.activities.some((entry) => entry.type === "EQUIPMENT_REMOVED"));
    assert.ok(!afterOptOut.notifications.some((notification) => notification.type === "EQUIPMENT_REMOVED"));
  });

  it("paginates the feed and marks a single notification as read", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);
    const organizer = await seedUser(workspace.id, "orga@abregi.test", { role: "ORGANIZER" });
    for (const label of ["Affiches", "Lumières", "Sono"]) {
      const expense = await request("POST", `/api/events/${event.id}/expenses`, authorization, { label, amount: "10", category: "Technique" });
      assert.equal(expense.statusCode, 201, expense.body);
    }

    const firstPage = await feed(organizer.authorization, "?category=budget&limit=2");
    assert.equal(firstPage.activities.length, 2);
    assert.ok(firstPage.nextCursor);
    const secondPage = await feed(organizer.authorization, `?category=budget&limit=2&cursor=${firstPage.nextCursor}`);
    assert.equal(secondPage.activities.length, 1);
    assert.equal(secondPage.nextCursor, null);

    const unread = firstPage.notifications.find((notification) => !notification.readAt)!;
    const read = await request("POST", `/api/activity/notifications/${unread.id}/read`, organizer.authorization);
    assert.equal(read.statusCode, 200, read.body);
    const afterRead = await feed(organizer.authorization);
    assert.equal(afterRead.unreadCount, firstPage.unreadCount - 1);

    const foreign = await request("POST", `/api/activity/notifications/${unread.id}/read`, authorization);
    assert.equal(json<{ updated: number }>(foreign).updated, 0);
  });
});
