import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "../src/prisma.js";
import {
  eventPayload,
  json,
  personPayload,
  request,
  seedAdminSession,
  setupTestApp,
} from "./helpers.js";

setupTestApp();

describe("people and event routes", () => {
  it("covers people CRUD, venue creation and event CRUD", async () => {
    const { authorization } = await seedAdminSession();

    const createdPerson = await request("POST", "/api/people", authorization, personPayload);
    assert.equal(createdPerson.statusCode, 201);
    const person = json<{ id: string; fullName: string }>(createdPerson);
    assert.equal(person.fullName, "Alice Martin");

    const people = await request("GET", "/api/people?search=alice&tags=staff", authorization);
    assert.equal(people.statusCode, 200);
    assert.equal(json<unknown[]>(people).length, 1);

    const tags = await request("GET", "/api/people/tags", authorization);
    assert.equal(tags.statusCode, 200);
    assert.deepEqual(json(tags), ["bar", "staff"]);

    assert.equal((await request("GET", `/api/people/${person.id}`, authorization)).statusCode, 200);
    assert.equal(
      (await request("PUT", `/api/people/${person.id}`, authorization, {
        fullName: "Alice Martin Updated",
        email: "alice@gwertable.test",
        phone: "",
        discordUserId: "",
        tags: ["staff"],
        notes: "",
      })).statusCode,
      200,
    );
    assert.equal((await request("POST", `/api/people/${person.id}/archive`, authorization)).statusCode, 200);
    assert.equal((await request("POST", `/api/people/${person.id}/restore`, authorization)).statusCode, 200);

    const createdVenue = await request("POST", "/api/events/venues", authorization, {
      name: "Warehouse",
    });
    assert.equal(createdVenue.statusCode, 201);
    const venue = json<{ id: string; name: string }>(createdVenue);

    const venues = await request("GET", "/api/events/venues", authorization);
    assert.equal(venues.statusCode, 200);
    assert.equal(json<unknown[]>(venues).length, 1);

    const createdEvent = await request("POST", "/api/events", authorization, {
      ...eventPayload,
      venueId: venue.id,
    });
    assert.equal(createdEvent.statusCode, 201);
    const event = json<{ id: string; name: string }>(createdEvent);

    const events = await request("GET", "/api/events", authorization);
    assert.equal(events.statusCode, 200);
    assert.equal(json<unknown[]>(events).length, 1);

    assert.equal((await request("GET", `/api/events/${event.id}`, authorization)).statusCode, 200);
    assert.equal(
      (await request("PUT", `/api/events/${event.id}`, authorization, {
        ...eventPayload,
        name: "Release Party Updated",
        venueId: venue.id,
      })).statusCode,
      200,
    );
    assert.equal((await request("DELETE", `/api/events/${event.id}`, authorization)).statusCode, 200);
    assert.equal((await request("GET", `/api/events/${event.id}`, authorization)).statusCode, 404);
  });

  it("does not expose people, venues or events from another workspace", async () => {
    const { authorization } = await seedAdminSession();
    const otherWorkspace = await prisma.workspace.create({
      data: { name: "Other association" },
    });
    const otherPerson = await prisma.person.create({
      data: {
        workspaceId: otherWorkspace.id,
        fullName: "Hidden Person",
        email: "hidden@gwertable.test",
        tags: ["hidden"],
      },
    });
    const otherVenue = await prisma.venue.create({
      data: {
        workspaceId: otherWorkspace.id,
        name: "Hidden Venue",
      },
    });
    await prisma.event.create({
      data: {
        workspaceId: otherWorkspace.id,
        name: "Hidden Event",
        startsAt: new Date("2026-07-01T20:00:00.000Z"),
        status: "PLANNING",
        venueId: otherVenue.id,
      },
    });

    const people = await request("GET", "/api/people?search=Hidden", authorization);
    assert.equal(people.statusCode, 200);
    assert.deepEqual(json(people), []);

    const tags = await request("GET", "/api/people/tags", authorization);
    assert.equal(tags.statusCode, 200);
    assert.deepEqual(json(tags), []);

    const search = await request("GET", "/api/people/search?q=Hidden", authorization);
    assert.equal(search.statusCode, 200);
    assert.deepEqual(json(search), []);

    const venues = await request("GET", "/api/events/venues", authorization);
    assert.equal(venues.statusCode, 200);
    assert.deepEqual(json(venues), []);

    const events = await request("GET", "/api/events", authorization);
    assert.equal(events.statusCode, 200);
    assert.deepEqual(json(events), []);

    const eventFromOtherWorkspace = await prisma.event.findFirstOrThrow({
      where: { workspaceId: otherWorkspace.id },
    });
    const eventById = await request("GET", `/api/events/${eventFromOtherWorkspace.id}`, authorization);
    assert.equal(eventById.statusCode, 404);

    const personById = await request("GET", `/api/people/${otherPerson.id}`, authorization);
    assert.equal(personById.statusCode, 404);
  });
});
