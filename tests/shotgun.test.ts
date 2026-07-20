import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { request, seedAdminSession, setupTestApp, json } from "./helpers.js";

setupTestApp();

describe("shotgun integration", () => {
  it("stores workspace credentials and syncs imported ticket tiers", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url.includes("smartboard-api.shotgun.live/api/shotgun/organizers/1234/events")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 313466,
                name: "ATOM - 31.12.2022 // Rome",
                startTime: "2022-12-31T21:00:57.000Z",
                endTime: "2023-01-01T21:00:21.000Z",
                slug: "atom-31-12-2022-rome",
                description: "Atom event",
                coverUrl: "https://example.com/banner.jpg",
                url: "https://shotgun.live/events/atom-31-12-2022-rome",
                deals: [
                  {
                    product_id: 284482,
                    name: "Pass Regular Entry",
                    quantity: 50,
                    price: 10,
                    organizer_fees: 0.99,
                    user_fees: 0.3,
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("api.shotgun.live/tickets")) {
        return new Response(
          JSON.stringify([
            { ticket_id: 1, ticket_status: "valid", deal_id: 284482 },
            { ticket_id: 2, ticket_status: "refunded", deal_id: 284482 },
            { ticket_id: 3, ticket_status: "resold", deal_id: 284482 },
            { ticket_id: 4, ticket_status: "valid", deal_id: 284482 },
            { ticket_id: 5, ticket_status: "transferred", deal_id: 284482 },
            { ticket_id: 6, ticket_status: "valid", deal_id: null },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    try {
      const { authorization } = await seedAdminSession();

      const workspaceUpdate = await request("PUT", "/api/workspace", authorization, {
        name: "Test workspace",
        shotgunOrganizerId: "1234",
        shotgunApiToken: "secret",
      });
      assert.equal(workspaceUpdate.statusCode, 200);
      const workspacePayload = json<{ workspace: { shotgunOrganizerId: string; shotgunConnected: boolean } }>(workspaceUpdate);
      assert.equal(workspacePayload.workspace.shotgunOrganizerId, "1234");
      assert.equal(workspacePayload.workspace.shotgunConnected, true);

      const event = await request("POST", "/api/events", authorization, {
        name: "Shotgun imported event",
        startsAt: "2026-06-01T20:00:00.000Z",
        endsAt: "2026-06-02T02:00:00.000Z",
        status: "PLANNING",
        description: "Imported",
        shotgunEventId: 313466,
      });
      assert.equal(event.statusCode, 201);
      const eventPayload = json<{ id: string }>(event);

      const sync = await request("POST", `/api/events/${eventPayload.id}/shotgun/sync`, authorization);
      assert.equal(sync.statusCode, 200);

      const tiers = await request("GET", `/api/events/${eventPayload.id}/ticket-tiers`, authorization);
      assert.equal(tiers.statusCode, 200);
      const tiersPayload = json<{
        shotgunDealId: number;
        name: string;
        quantity: number;
        sold: number;
      }[]>(tiers);
      assert.equal(tiersPayload.length, 1);
      assert.equal(tiersPayload[0]!.shotgunDealId, 284482);
      assert.equal(tiersPayload[0]!.quantity, 50);
      assert.equal(tiersPayload[0]!.sold, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
