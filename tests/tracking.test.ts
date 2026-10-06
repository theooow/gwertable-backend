import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eventPayload, json, request, seedAdminSession, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

describe("tracking routes", () => {
  it("records anonymous landing visits with their source and only the referrer host", async () => {
    const visit = await request("POST", "/api/public/tracking/landing", undefined, {
      anonymousId: "anon-12345678", path: "/", referrer: "https://www.instagram.com/p/abc?email=x@y.z",
    });
    assert.equal(visit.statusCode, 204);
    const campaign = await request("POST", "/api/public/tracking/landing", undefined, {
      anonymousId: "anon-87654321", utmSource: "Newsletter", utmCampaign: "rentree",
    });
    assert.equal(campaign.statusCode, 204);

    const rows = await prisma.trackingEvent.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(rows.map((row) => row.properties), [
      { path: "/", source: "instagram.com", medium: "referral", campaign: null, referrerHost: "instagram.com" },
      { path: "/", source: "newsletter", medium: "none", campaign: "rentree", referrerHost: null },
    ]);
    assert.equal((await request("POST", "/api/public/tracking/landing", undefined, { anonymousId: "x" })).statusCode, 400);
  });

  it("records budget signals for the signed-in user and rejects foreign events", async () => {
    const { authorization, user, workspace } = await seedAdminSession();
    const event = json<{ id: string }>(await request("POST", "/api/events", authorization, eventPayload));

    assert.equal((await request("POST", "/api/tracking/events", undefined, { name: "budget_viewed" })).statusCode, 401);
    const viewed = await request("POST", "/api/tracking/events", authorization, {
      name: "budget_viewed", eventId: event.id, anonymousId: "anon-12345678", detail: "overview",
    });
    assert.equal(viewed.statusCode, 204);
    const row = await prisma.trackingEvent.findFirstOrThrow({ where: { name: "budget_viewed" } });
    assert.equal(row.userId, user.id);
    assert.equal(row.workspaceId, workspace.id);
    assert.equal(row.eventId, event.id);
    assert.deepEqual(row.properties, { detail: "overview" });

    const other = await prisma.workspace.create({ data: { name: "Other", events: { create: { name: "Hidden", startsAt: new Date() } } }, include: { events: true } });
    assert.equal((await request("POST", "/api/tracking/events", authorization, { name: "budget_viewed", eventId: other.events[0].id })).statusCode, 404);
    assert.equal((await request("POST", "/api/tracking/events", authorization, { name: "page_hacked" })).statusCode, 400);
  });
});
