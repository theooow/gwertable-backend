import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchShotgunEvents, fetchShotgunTickets, groupShotgunSoldTickets } from "../src/lib/shotgun.js";
import { matchEventGenres } from "../src/lib/event-genres.js";

describe("shotgun client", () => {
  it("follows every ticket page before returning sales", async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);

      if (url.includes("after=cursor-1")) {
        return new Response(
          JSON.stringify({
            data: [{ ticket_id: 2, ticket_status: "valid", deal_id: 284482 }],
            pagination: { next: null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          data: [{ ticket_id: 1, ticket_status: "valid", deal_id: 284482 }],
          pagination: {
            next: "https://api.shotgun.live/tickets?token=secret&after=cursor-1",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    try {
      const tickets = await fetchShotgunTickets({ organizerId: "1234", apiToken: "secret" }, 313466);
      const counts = groupShotgunSoldTickets(tickets);

      assert.equal(requests.length, 2);
      assert.equal(counts.get(284482), 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps syncing tickets when Shotgun returns unknown statuses", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          { ticket_id: 1, ticket_status: "valid", deal_id: 284482 },
          { ticket_id: 2, ticket_status: "transferred", deal_id: 284482 },
          { ticket_id: 3, ticket_status: "valid", deal_id: null },
          { ticket_id: 4, ticket_status: "pending_approval", deal_id: 284482 },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    try {
      const tickets = await fetchShotgunTickets({ organizerId: "1234", apiToken: "secret" }, 313466);
      const counts = groupShotgunSoldTickets(tickets);

      assert.equal(counts.get(284482), 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps optional genre labels to the closed list and tolerates their absence", async () => {
    assert.deepEqual(matchEventGenres(["Hard Techno", "Drum'n'Bass", "Électronique", "Polka"]), ["HARD_MUSIC", "DRUM_AND_BASS", "ELECTRO"]);
    const originalFetch = globalThis.fetch;
    const event = { id: 1, name: "Rave", startTime: "2026-06-01T20:00:00Z", deals: [] };
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [
      { ...event, genres: ["Techno", { name: "House" }] },
      { ...event, id: 2, tags: "not-an-array" },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
    try {
      const events = await fetchShotgunEvents({ organizerId: "1234", apiToken: "secret" });
      assert.deepEqual(events.map((e) => e.genres), [["TECHNO", "HOUSE"], []]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
