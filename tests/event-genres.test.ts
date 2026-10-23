import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eventPayload, json, request, seedAdminSession, setupTestApp } from "./helpers.js";
setupTestApp();
describe("event genres", () => {
  it("stores genres from the closed list and keeps them when an update omits them", async () => {
    const { authorization } = await seedAdminSession();
    const created = await request("POST", "/api/events", authorization, { ...eventPayload, genres: ["TECHNO", "HOUSE", "TECHNO"] });
    assert.equal(created.statusCode, 201, created.body);
    const event = json<{ id: string; genres: string[] }>(created);
    assert.deepEqual(event.genres, ["TECHNO", "HOUSE"]);
    const updated = await request("PUT", `/api/events/${event.id}`, authorization, { ...eventPayload, name: "Renamed" });
    assert.deepEqual(json<{ genres: string[] }>(updated).genres, ["TECHNO", "HOUSE"]);
    assert.equal((await request("POST", "/api/events", authorization, { ...eventPayload, genres: ["Techno minimale"] })).statusCode, 400);
  });
});
