import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import type { InjectOptions, InjectPayload, Response as InjectResponse } from "light-my-request";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";

let app: FastifyInstance;

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Account",
      "Announcement",
      "Channel",
      "Document",
      "EquipmentItem",
      "EquipmentUsage",
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
      "User",
      "Venue",
      "VerificationToken"
    RESTART IDENTITY CASCADE
  `);
}

async function seedAdminSession() {
  const user = await prisma.user.create({
    data: {
      email: "admin@gwertable.test",
      role: "ADMIN",
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
    user,
  };
}

async function request(
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

function json<T>(response: InjectResponse): T {
  return response.json() as T;
}

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

describe("backend routes", () => {
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
    const verifiedPayload = json<{ sessionToken: string; user: { email: string; role: string } }>(
      verified,
    );
    assert.equal(verifiedPayload.user.email, "admin@gwertable.test");
    assert.equal(verifiedPayload.user.role, "VIEWER");

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

  it("covers people, events, participants, tasks, expenses and shopping routes", async () => {
    const { authorization } = await seedAdminSession();

    const createdPerson = await request("POST", "/api/people", authorization, {
      fullName: "Alice Martin",
      email: "alice@gwertable.test",
      phone: "0600000000",
      discordUserId: "",
      tags: ["staff", "bar"],
      notes: "Disponible",
    });
    assert.equal(createdPerson.statusCode, 201);
    const person = json<{ id: string; fullName: string }>(createdPerson);
    assert.equal(person.fullName, "Alice Martin");

    const people = await request("GET", "/api/people?search=alice&tags=staff", authorization);
    assert.equal(people.statusCode, 200);
    assert.equal(json<unknown[]>(people).length, 1);

    const tags = await request("GET", "/api/people/tags", authorization);
    assert.equal(tags.statusCode, 200);
    assert.deepEqual(json(tags), ["bar", "staff"]);

    const personById = await request("GET", `/api/people/${person.id}`, authorization);
    assert.equal(personById.statusCode, 200);

    const updatedPerson = await request("PUT", `/api/people/${person.id}`, authorization, {
      fullName: "Alice Martin Updated",
      email: "alice@gwertable.test",
      phone: "",
      discordUserId: "",
      tags: ["staff"],
      notes: "",
    });
    assert.equal(updatedPerson.statusCode, 200);

    const archivedPerson = await request("POST", `/api/people/${person.id}/archive`, authorization);
    assert.equal(archivedPerson.statusCode, 200);

    const restoredPerson = await request("POST", `/api/people/${person.id}/restore`, authorization);
    assert.equal(restoredPerson.statusCode, 200);

    const createdVenue = await request("POST", "/api/events/venues", authorization, {
      name: "Warehouse",
    });
    assert.equal(createdVenue.statusCode, 201);
    const venue = json<{ id: string; name: string }>(createdVenue);

    const venues = await request("GET", "/api/events/venues", authorization);
    assert.equal(venues.statusCode, 200);
    assert.equal(json<unknown[]>(venues).length, 1);

    const eventPayload = {
      name: "Release Party",
      startsAt: "2026-06-01T20:00:00.000Z",
      endsAt: "2026-06-02T02:00:00.000Z",
      status: "PLANNING",
      description: "Soiree de lancement",
      venueId: venue.id,
    };
    const createdEvent = await request("POST", "/api/events", authorization, eventPayload);
    assert.equal(createdEvent.statusCode, 201);
    const event = json<{ id: string; name: string }>(createdEvent);

    const events = await request("GET", "/api/events", authorization);
    assert.equal(events.statusCode, 200);
    assert.equal(json<unknown[]>(events).length, 1);

    const eventById = await request("GET", `/api/events/${event.id}`, authorization);
    assert.equal(eventById.statusCode, 200);

    const updatedEvent = await request("PUT", `/api/events/${event.id}`, authorization, {
      ...eventPayload,
      name: "Release Party Updated",
    });
    assert.equal(updatedEvent.statusCode, 200);

    const participantPayload = {
      personId: person.id,
      roles: ["STAFF"],
      rsvpStatus: "YES",
      plusOnes: 0,
      dietary: "",
      setStart: "",
      setEnd: "",
      fee: "12.50",
      contractSigned: true,
      internalNotes: "Arrive early",
    };
    const createdParticipant = await request(
      "POST",
      `/api/events/${event.id}/participants`,
      authorization,
      participantPayload,
    );
    assert.equal(createdParticipant.statusCode, 201);
    const participant = json<{ id: string }>(createdParticipant);

    const participants = await request("GET", `/api/events/${event.id}/participants`, authorization);
    assert.equal(participants.statusCode, 200);
    assert.equal(json<unknown[]>(participants).length, 1);

    const participantPersons = await request(
      "GET",
      `/api/events/${event.id}/participants/persons`,
      authorization,
    );
    assert.equal(participantPersons.statusCode, 200);
    assert.equal(json<unknown[]>(participantPersons).length, 1);

    const updatedParticipantByEvent = await request(
      "PUT",
      `/api/events/${event.id}/participants/${participant.id}`,
      authorization,
      { ...participantPayload, plusOnes: 1 },
    );
    assert.equal(updatedParticipantByEvent.statusCode, 200);

    const updatedParticipant = await request("PUT", `/api/participants/${participant.id}`, authorization, {
      ...participantPayload,
      plusOnes: 2,
    });
    assert.equal(updatedParticipant.statusCode, 200);

    const taskPayload = {
      title: "Prepare bar",
      description: "Stock drinks",
      category: "bar",
      status: "TODO",
      priority: "HIGH",
      dueAt: "2026-06-01T18:00:00.000Z",
      assigneeId: person.id,
    };
    const createdTask = await request("POST", `/api/events/${event.id}/tasks`, authorization, taskPayload);
    assert.equal(createdTask.statusCode, 201);
    const task = json<{ id: string }>(createdTask);

    assert.equal((await request("GET", `/api/events/${event.id}/tasks`, authorization)).statusCode, 200);
    assert.equal(
      (await request("PUT", `/api/events/${event.id}/tasks/${task.id}`, authorization, taskPayload)).statusCode,
      200,
    );
    assert.equal((await request("PUT", `/api/tasks/${task.id}`, authorization, taskPayload)).statusCode, 200);
    assert.equal(
      (await request("PATCH", `/api/events/${event.id}/tasks/${task.id}/status`, authorization, {
        status: "DONE",
      })).statusCode,
      200,
    );
    assert.equal(
      (await request("PATCH", `/api/tasks/${task.id}/status`, authorization, { status: "DOING" })).statusCode,
      200,
    );

    const expensePayload = {
      label: "Boissons",
      amount: "42.50",
      category: "bar",
      paidById: person.id,
      paidAt: "2026-06-01T19:00:00.000Z",
      reimbursement: "PENDING",
      receiptUrl: "",
      notes: "",
    };
    const createdExpense = await request(
      "POST",
      `/api/events/${event.id}/expenses`,
      authorization,
      expensePayload,
    );
    assert.equal(createdExpense.statusCode, 201);
    const expense = json<{ id: string }>(createdExpense);

    assert.equal((await request("GET", `/api/events/${event.id}/expenses`, authorization)).statusCode, 200);
    assert.equal(
      (await request("GET", `/api/events/${event.id}/expenses/persons`, authorization)).statusCode,
      200,
    );
    assert.equal(
      (await request("PUT", `/api/events/${event.id}/expenses/${expense.id}`, authorization, expensePayload))
        .statusCode,
      200,
    );
    assert.equal((await request("PUT", `/api/expenses/${expense.id}`, authorization, expensePayload)).statusCode, 200);

    const shoppingPayload = {
      name: "Ice",
      quantity: "3",
      unit: "bags",
      category: "bar",
      estimatedCents: "15.00",
      buyerId: person.id,
    };
    const createdShopping = await request(
      "POST",
      `/api/events/${event.id}/shopping`,
      authorization,
      shoppingPayload,
    );
    assert.equal(createdShopping.statusCode, 201);
    const shopping = json<{ id: string }>(createdShopping);

    assert.equal((await request("GET", `/api/events/${event.id}/shopping`, authorization)).statusCode, 200);
    assert.equal(
      (await request("GET", `/api/events/${event.id}/shopping/persons`, authorization)).statusCode,
      200,
    );
    assert.equal(
      (await request("PUT", `/api/events/${event.id}/shopping/${shopping.id}`, authorization, shoppingPayload))
        .statusCode,
      200,
    );
    assert.equal((await request("PUT", `/api/shopping/${shopping.id}`, authorization, shoppingPayload)).statusCode, 200);
    assert.equal(
      (await request("PATCH", `/api/events/${event.id}/shopping/${shopping.id}/bought`, authorization, {
        bought: true,
      })).statusCode,
      200,
    );
    assert.equal(
      (await request("PATCH", `/api/shopping/${shopping.id}/bought`, authorization, { bought: false })).statusCode,
      200,
    );
    assert.equal(
      (await request("POST", `/api/events/${event.id}/shopping/${shopping.id}/bought-with-expense`, authorization, {
        amountCents: 1500,
        paidById: person.id,
      })).statusCode,
      200,
    );

    const secondShopping = await request("POST", `/api/events/${event.id}/shopping`, authorization, {
      ...shoppingPayload,
      name: "Cups",
    });
    assert.equal(secondShopping.statusCode, 201);
    assert.equal(
      (await request(
        "POST",
        `/api/shopping/${json<{ id: string }>(secondShopping).id}/bought-with-expense`,
        authorization,
        {
          amountCents: 500,
          paidById: null,
        },
      )).statusCode,
      200,
    );

    const search = await request("GET", "/api/people/search?q=Alice", authorization);
    assert.equal(search.statusCode, 200);
    assert.equal(json<unknown[]>(search).length, 1);

    assert.equal(
      (await request("DELETE", `/api/events/${event.id}/shopping/${shopping.id}`, authorization)).statusCode,
      200,
    );
    const thirdShopping = await request("POST", `/api/events/${event.id}/shopping`, authorization, {
      ...shoppingPayload,
      name: "Napkins",
    });
    assert.equal(thirdShopping.statusCode, 201);
    assert.equal(
      (await request("DELETE", `/api/shopping/${json<{ id: string }>(thirdShopping).id}`, authorization)).statusCode,
      200,
    );

    assert.equal(
      (await request("DELETE", `/api/events/${event.id}/expenses/${expense.id}`, authorization)).statusCode,
      200,
    );
    const secondExpense = await request("POST", `/api/events/${event.id}/expenses`, authorization, {
      ...expensePayload,
      label: "Snacks",
    });
    assert.equal(secondExpense.statusCode, 201);
    assert.equal(
      (await request("DELETE", `/api/expenses/${json<{ id: string }>(secondExpense).id}`, authorization)).statusCode,
      200,
    );

    assert.equal((await request("DELETE", `/api/events/${event.id}/tasks/${task.id}`, authorization)).statusCode, 200);
    const secondTask = await request("POST", `/api/events/${event.id}/tasks`, authorization, {
      ...taskPayload,
      title: "Clean room",
    });
    assert.equal(secondTask.statusCode, 201);
    assert.equal(
      (await request("DELETE", `/api/tasks/${json<{ id: string }>(secondTask).id}`, authorization)).statusCode,
      200,
    );

    assert.equal(
      (await request("DELETE", `/api/events/${event.id}/participants/${participant.id}`, authorization)).statusCode,
      200,
    );
    const secondParticipant = await request(
      "POST",
      `/api/events/${event.id}/participants`,
      authorization,
      participantPayload,
    );
    assert.equal(secondParticipant.statusCode, 201);
    assert.equal(
      (await request("DELETE", `/api/participants/${json<{ id: string }>(secondParticipant).id}`, authorization))
        .statusCode,
      200,
    );
  });
});
