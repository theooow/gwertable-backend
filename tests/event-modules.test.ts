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
      roles: ["ARTIST"],
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

    const expensesAfterCreate = json<
      Array<{ id: string; sourceParticipantId: string | null; amountCents: number; category: string }>
    >(await request("GET", `/api/events/${event.id}/expenses`, authorization));
    const linkedExpense = expensesAfterCreate.find((expense) => expense.sourceParticipantId === participant.id);
    assert.ok(linkedExpense);
    assert.equal(linkedExpense?.amountCents, 1250);
    assert.equal(linkedExpense?.category, "artistes");

    assert.equal((await request("GET", `/api/events/${event.id}/participants`, authorization)).statusCode, 200);
    assert.equal(
      (await request("GET", `/api/events/${event.id}/participants/persons`, authorization)).statusCode,
      200,
    );
    assert.equal(
      (await request("PUT", `/api/events/${event.id}/participants/${participant.id}`, authorization, {
        ...participantPayload,
        fee: "18.00",
        plusOnes: 1,
      })).statusCode,
      200,
    );
    const expensesAfterUpdate = json<
      Array<{ id: string; sourceParticipantId: string | null; amountCents: number }>
    >(await request("GET", `/api/events/${event.id}/expenses`, authorization));
    assert.equal(
      expensesAfterUpdate.find((expense) => expense.sourceParticipantId === participant.id)?.amountCents,
      1800,
    );
    assert.equal(
      (await request("PUT", `/api/participants/${participant.id}`, authorization, {
        ...participantPayload,
        roles: ["STAFF"],
        fee: "",
        plusOnes: 2,
      })).statusCode,
      200,
    );
    const expensesAfterRoleRemoval = json<
      Array<{ id: string; sourceParticipantId: string | null }>
    >(await request("GET", `/api/events/${event.id}/expenses`, authorization));
    assert.equal(
      expensesAfterRoleRemoval.some((expense) => expense.sourceParticipantId === participant.id),
      false,
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
    const task = json<{ id: string; autoRunOfShowItem: { id: string; sourceTaskId: string; responsiblePersonId: string } }>(createdTask);
    assert.equal(task.autoRunOfShowItem.sourceTaskId, task.id);
    assert.equal(task.autoRunOfShowItem.responsiblePersonId, person.id);

    assert.equal((await request("GET", `/api/events/${event.id}/tasks`, authorization)).statusCode, 200);
    const calendar = await request("GET", `/api/events/${event.id}/tasks/calendar.ics`, authorization);
    assert.equal(calendar.statusCode, 200);
    assert.match(calendar.body, /BEGIN:VCALENDAR/);
    assert.match(calendar.body, /SUMMARY:Prepare bar/);
    assert.match(calendar.body, /BEGIN:VALARM/);
    assert.match(calendar.body, /TRIGGER:-P1D/);
    assert.match(calendar.body, /TRIGGER:PT0S/);
    assert.match(calendar.body, /REFRESH-INTERVAL;VALUE=DURATION:PT15M/);
    assert.match(calendar.body, /SEQUENCE:/);
    const subscription = await request("GET", `/api/events/${event.id}/tasks/calendar-subscription`, authorization);
    assert.equal(subscription.statusCode, 200);
    const subscriptionToken = json<{ token: string }>(subscription).token;
    const syncedCalendar = await request("GET", `/calendar/tasks/${subscriptionToken}`);
    assert.equal(syncedCalendar.statusCode, 200);
    assert.match(syncedCalendar.body, /SUMMARY:Prepare bar/);

    const runOfShowAfterTaskCreate = json<
      Array<{
        id: string;
        sourceTaskId: string | null;
        title: string;
        startsAt: string;
        responsiblePersonId: string | null;
        notes: string | null;
      }>
    >(await request("GET", `/api/events/${event.id}/run-of-show`, authorization));
    const linkedRunOfShow = runOfShowAfterTaskCreate.find((item) => item.sourceTaskId === task.id);
    assert.ok(linkedRunOfShow);
    assert.equal(linkedRunOfShow?.title, taskPayload.title);
    assert.equal(linkedRunOfShow?.responsiblePersonId, person.id);

    const updatedTaskPayload = {
      ...taskPayload,
      title: "Prepare the bar",
      description: "Stock drinks and ice",
      dueAt: "2026-06-01T19:15:00.000Z",
      assigneeId: "",
    };
    assert.equal(
      (await request("PUT", `/api/events/${event.id}/tasks/${task.id}`, authorization, updatedTaskPayload)).statusCode,
      200,
    );
    const runOfShowAfterTaskUpdate = json<
      Array<{
        id: string;
        sourceTaskId: string | null;
        title: string;
        startsAt: string;
        responsiblePersonId: string | null;
        notes: string | null;
      }>
    >(await request("GET", `/api/events/${event.id}/run-of-show`, authorization));
    const updatedLinkedRunOfShow = runOfShowAfterTaskUpdate.find((item) => item.sourceTaskId === task.id);
    assert.ok(updatedLinkedRunOfShow);
    const linkedRunOfShowId = updatedLinkedRunOfShow.id;
    assert.equal(updatedLinkedRunOfShow?.title, updatedTaskPayload.title);
    assert.equal(updatedLinkedRunOfShow?.startsAt, updatedTaskPayload.dueAt);
    assert.equal(updatedLinkedRunOfShow?.responsiblePersonId, null);
    assert.equal(updatedLinkedRunOfShow?.notes, updatedTaskPayload.description);

    const updatedRunOfShowPayload = {
      startsAt: "2026-06-01T20:30:00.000Z",
      durationMin: 50,
      title: "Ouverture des portes",
      responsible: "Regie",
      responsiblePersonId: "",
      notes: "Verifier l'accueil, la billetterie et les badges",
    };
    assert.equal(
      (await request("PUT", `/api/run-of-show/${linkedRunOfShowId}`, authorization, updatedRunOfShowPayload))
        .statusCode,
      200,
    );
    const tasksAfterRunOfShowUpdate = json<
      Array<{ id: string; title: string; description: string | null; dueAt: string | null; assigneeId: string | null }>
    >(await request("GET", `/api/events/${event.id}/tasks`, authorization));
    const syncedTask = tasksAfterRunOfShowUpdate.find((item) => item.id === task.id);
    assert.ok(syncedTask);
    assert.equal(syncedTask?.title, updatedRunOfShowPayload.title);
    assert.equal(syncedTask?.description, updatedRunOfShowPayload.notes);
    assert.equal(syncedTask?.dueAt, updatedRunOfShowPayload.startsAt);
    assert.equal(syncedTask?.assigneeId, null);

    assert.equal((await request("PUT", `/api/tasks/${task.id}`, authorization, updatedTaskPayload)).statusCode, 200);
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

    const trackPayload = { name: "Regie son", color: "#2563eb" };
    const createdTrack = await request(
      "POST",
      `/api/events/${event.id}/run-of-show/tracks`,
      authorization,
      trackPayload,
    );
    assert.equal(createdTrack.statusCode, 201);
    const track = json<{ id: string; name: string; color: string | null; _count: { items: number } }>(createdTrack);
    assert.equal(track.name, trackPayload.name);
    assert.equal(track.color, trackPayload.color);
    assert.equal(track._count.items, 0);

    const trackList = await request("GET", `/api/events/${event.id}/run-of-show/tracks`, authorization);
    assert.equal(trackList.statusCode, 200);
    assert.equal(json<unknown[]>(trackList).length, 1);
    assert.equal(
      (await request("PUT", `/api/run-of-show/tracks/${track.id}`, authorization, {
        name: "Regie plateau",
        color: "#16a34a",
      })).statusCode,
      200,
    );

    const sectionPayload = { name: "Montage", color: "#f97316" };
    const createdSection = await request(
      "POST",
      `/api/events/${event.id}/run-of-show/sections`,
      authorization,
      sectionPayload,
    );
    assert.equal(createdSection.statusCode, 201);
    const section = json<{ id: string; name: string; color: string | null; _count: { items: number } }>(createdSection);
    assert.equal(section.name, sectionPayload.name);
    assert.equal(section.color, sectionPayload.color);
    assert.equal(section._count.items, 0);

    const sectionList = await request("GET", `/api/events/${event.id}/run-of-show/sections`, authorization);
    assert.equal(sectionList.statusCode, 200);
    assert.equal(json<unknown[]>(sectionList).length, 1);
    assert.equal(
      (await request("PUT", `/api/run-of-show/sections/${section.id}`, authorization, {
        name: "Ouverture",
        color: "#f59e0b",
      })).statusCode,
      200,
    );

    const runOfShowPayload = {
      trackId: track.id,
      sectionId: section.id,
      status: "DELAYED",
      startsAt: "2026-06-01T20:00:00.000Z",
      durationMin: 45,
      title: "Ouverture des portes",
      responsible: "Regie",
      responsiblePersonId: person.id,
      notes: "Verifier l'accueil et la billetterie",
      stakeholderNote: "Ouverture retardee de 10 minutes",
      delayReason: "Controle securite en cours",
      actualStartedAt: "2026-06-01T20:10:00.000Z",
      completedAt: "",
      dependsOnIds: [linkedRunOfShowId],
    };
    const createdRunOfShow = await request(
      "POST",
      `/api/events/${event.id}/run-of-show`,
      authorization,
      runOfShowPayload,
    );
    assert.equal(createdRunOfShow.statusCode, 201);
    const runOfShow = json<{
      id: string;
      trackId: string | null;
      sectionId: string | null;
      status: string;
      stakeholderNote: string | null;
      delayReason: string | null;
      track: { id: string; name: string } | null;
      section: { id: string; name: string } | null;
      dependsOn: Array<{ dependsOn: { id: string } }>;
    }>(createdRunOfShow);
    assert.equal(runOfShow.trackId, track.id);
    assert.equal(runOfShow.sectionId, section.id);
    assert.equal(runOfShow.status, "DELAYED");
    assert.equal(runOfShow.stakeholderNote, "Ouverture retardee de 10 minutes");
    assert.equal(runOfShow.delayReason, "Controle securite en cours");
    assert.equal(runOfShow.track?.name, "Regie plateau");
    assert.equal(runOfShow.section?.name, "Ouverture");
    assert.equal(runOfShow.dependsOn[0]?.dependsOn.id, linkedRunOfShowId);

    const runOfShowList = await request("GET", `/api/events/${event.id}/run-of-show`, authorization);
    assert.equal(runOfShowList.statusCode, 200);
    assert.equal(json<unknown[]>(runOfShowList).length, 2);
    assert.equal(
      (await request("PUT", `/api/events/${event.id}/run-of-show/${runOfShow.id}`, authorization, {
        ...runOfShowPayload,
        durationMin: 50,
      })).statusCode,
      200,
    );
    assert.equal(
      (await request("PUT", `/api/run-of-show/${runOfShow.id}`, authorization, runOfShowPayload)).statusCode,
      200,
    );
    assert.equal((await request("DELETE", `/api/run-of-show/tracks/${track.id}`, authorization)).statusCode, 200);
    const runOfShowAfterTrackDelete = json<Array<{ id: string; trackId: string | null }>>(
      await request("GET", `/api/events/${event.id}/run-of-show`, authorization),
    );
    assert.equal(runOfShowAfterTrackDelete.find((item) => item.id === runOfShow.id)?.trackId, null);
    assert.equal((await request("DELETE", `/api/run-of-show/sections/${section.id}`, authorization)).statusCode, 200);
    const runOfShowAfterSectionDelete = json<Array<{ id: string; sectionId: string | null }>>(
      await request("GET", `/api/events/${event.id}/run-of-show`, authorization),
    );
    assert.equal(runOfShowAfterSectionDelete.find((item) => item.id === runOfShow.id)?.sectionId, null);

    const linkedTaskBeforeDelete = await request("POST", `/api/events/${event.id}/tasks`, authorization, {
      ...taskPayload,
      title: "Load in",
      dueAt: "2026-06-01T17:00:00.000Z",
    });
    assert.equal(linkedTaskBeforeDelete.statusCode, 201);
    const secondTask = json<{ id: string }>(linkedTaskBeforeDelete);
    assert.equal((await request("DELETE", `/api/tasks/${secondTask.id}`, authorization)).statusCode, 200);
    const tasksAfterDelete = json<Array<{ id: string }>>(await request("GET", `/api/events/${event.id}/tasks`, authorization));
    assert.equal(tasksAfterDelete.some((item) => item.id === secondTask.id), false);

    assert.equal((await request("DELETE", `/api/run-of-show/${linkedRunOfShowId}`, authorization)).statusCode, 200);
    const tasksAfterRunOfShowDelete = json<Array<{ id: string }>>(await request("GET", `/api/events/${event.id}/tasks`, authorization));
    assert.equal(tasksAfterRunOfShowDelete.some((item) => item.id === task.id), false);

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

    const thirdTask = await request("POST", `/api/events/${event.id}/tasks`, authorization, {
      ...taskPayload,
      title: "Clean room",
    });
    assert.equal(thirdTask.statusCode, 201);
    assert.equal(
      (await request("DELETE", `/api/tasks/${json<{ id: string }>(thirdTask).id}`, authorization)).statusCode,
      200,
    );

    assert.equal(
      (await request("DELETE", `/api/events/${event.id}/run-of-show/${runOfShow.id}`, authorization)).statusCode,
      200,
    );
    const secondRunOfShow = await request("POST", `/api/events/${event.id}/run-of-show`, authorization, {
      ...runOfShowPayload,
      trackId: "",
      sectionId: "",
      dependsOnIds: [],
      title: "Debrief",
    });
    assert.equal(secondRunOfShow.statusCode, 201);
    assert.equal(
      (await request("DELETE", `/api/run-of-show/${json<{ id: string }>(secondRunOfShow).id}`, authorization))
        .statusCode,
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
      {
        ...participantPayload,
        roles: ["ARTIST"],
        fee: "9.00",
      },
    );
    assert.equal(secondParticipant.statusCode, 201);
    const secondParticipantJson = json<{ id: string }>(secondParticipant);
    assert.equal(
      json<Array<{ sourceParticipantId: string | null }>>(
        await request("GET", `/api/events/${event.id}/expenses`, authorization),
      ).some((expense) => expense.sourceParticipantId === secondParticipantJson.id),
      true,
    );
    assert.equal(
      (await request("DELETE", `/api/participants/${secondParticipantJson.id}`, authorization)).statusCode,
      200,
    );
    assert.equal(
      json<Array<{ sourceParticipantId: string | null }>>(
        await request("GET", `/api/events/${event.id}/expenses`, authorization),
      ).some((expense) => expense.sourceParticipantId === secondParticipantJson.id),
      false,
    );
  });
});
