import { after, before, beforeEach } from "node:test";
import type { FastifyInstance } from "fastify";
import type { InjectOptions, InjectPayload, Response as InjectResponse } from "light-my-request";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";

let app: FastifyInstance;

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Account",
      "Announcement",
      "Channel",
      "Document",
      "EquipmentItem",
      "EquipmentQuote",
      "EquipmentUsage",
      "EventCollaborator",
      "Event",
      "EventParticipant",
      "Expense",
      "Income",
      "Person",
      "RunOfShowItem",
      "Session",
      "Shift",
      "ShoppingItem",
      "Supplier",
      "Task",
      "TaskAssignee",
      "TicketTier",
      "TaskCalendarSubscription",
      "EventNotificationSettings",
      "NotificationDelivery",
      "User",
      "Venue",
      "VerificationToken",
      "WorkspaceMember",
      "WorkspaceInvitation",
      "Workspace"
    RESTART IDENTITY CASCADE
  `);
}

export function setupTestApp() {
  before(async () => {
    app = await buildApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  after(async () => {
    await app.close();
    await prisma.$disconnect();
  });
}

export async function seedAdminSession() {
  const workspace = await prisma.workspace.create({
    data: { name: "Test workspace" },
  });
  const user = await prisma.user.create({
    data: {
      email: "admin@abregi.test",
      role: "ADMIN",
      defaultWorkspaceId: workspace.id,
      workspaceMemberships: {
        create: {
          workspaceId: workspace.id,
          role: "ADMIN",
        },
      },
    },
  });
  const session = await prisma.session.create({
    data: {
      sessionToken: "test-admin-session",
      userId: user.id,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return {
    authorization: `Bearer ${session.sessionToken}`,
    workspace,
    user,
  };
}

export async function request(
  method: InjectOptions["method"],
  url: string,
  token?: string,
  payload?: InjectPayload,
): Promise<InjectResponse> {
  return app.inject({
    method,
    url,
    headers: token ? { authorization: token } : undefined,
    payload,
  });
}

export function json<T>(response: InjectResponse): T {
  return response.json() as T;
}

export const personPayload = {
  fullName: "Alice Martin",
  email: "alice@abregi.test",
  phone: "0600000000",
  discordUserId: "",
  tags: ["staff", "bar"],
  notes: "Disponible",
};

export const eventPayload = {
  name: "Release Party",
  startsAt: "2026-06-01T20:00:00.000Z",
  endsAt: "2026-06-02T02:00:00.000Z",
  status: "PLANNING",
  description: "Soiree de lancement",
};

export async function seedEventContext(authorization: string) {
  const createdPerson = await request("POST", "/api/people", authorization, personPayload);
  const person = json<{ id: string; fullName: string }>(createdPerson);

  const createdVenue = await request("POST", "/api/events/venues", authorization, {
    name: "Warehouse",
  });
  const venue = json<{ id: string; name: string }>(createdVenue);

  const createdEvent = await request("POST", "/api/events", authorization, {
    ...eventPayload,
    venueId: venue.id,
  });
  const event = json<{ id: string; name: string }>(createdEvent);

  return { person, venue, event };
}
