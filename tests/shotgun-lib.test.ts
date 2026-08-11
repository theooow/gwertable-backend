import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchShotgunTickets, groupShotgunSoldTickets } from "../src/lib/shotgun.js";

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
});
