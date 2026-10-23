import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { request, seedAdminSession, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
setupTestApp();
describe("last activity", () => {
  it("refreshes the last activity and clears a pending inactivity warning", async () => {
    const { authorization, user } = await seedAdminSession();
    await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date("2020-01-01"), inactivityWarnedAt: new Date("2023-01-01") } });
    assert.equal((await request("GET", "/api/auth/me", authorization)).statusCode, 200);
    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(refreshed.lastSeenAt > new Date(Date.now() - 60_000));
    assert.equal(refreshed.inactivityWarnedAt, null);
  });
});
