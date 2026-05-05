import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";

setupTestApp();

describe("event module routes", () => {
  it("covers participants, tasks, expenses, shopping and people search", async () => {
    const { authorization } = await seedAdminSession();
    const { person, event } = await seedEventContext(authorization);

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

    assert.equal((await request("GET", `/api/events/${event.id}/participants`, authorization)).statusCode, 200);
    assert.equal(
      (await request("GET", `/api/events/${event.id}/participants/persons`, authorization)).statusCode,
      200,
    );
    assert.equal(
      (await request("PUT", `/api/events/${event.id}/participants/${participant.id}`, authorization, {
        ...participantPayload,
        plusOnes: 1,
      })).statusCode,
      200,
    );
    assert.equal(
      (await request("PUT", `/api/participants/${participant.id}`, authorization, {
        ...participantPayload,
        plusOnes: 2,
      })).statusCode,
      200,
    );

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
