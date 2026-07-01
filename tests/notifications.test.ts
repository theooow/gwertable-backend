import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";

setupTestApp();

describe("event notification settings", () => {
  it("returns defaults and updates discord settings", async () => {
    const { authorization } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);

    const defaultsResponse = await request("GET", `/api/events/${event.id}/notifications`, authorization);
    assert.equal(defaultsResponse.statusCode, 200);
    const defaults = json<{
      enabled: boolean;
      discordChannelId: string | null;
      taskReminderOffsetsMinutes: number[];
      runOfShowReminderOffsetsMinutes: number[];
      overdueEnabled: boolean;
    }>(defaultsResponse);
    assert.equal(defaults.enabled, false);
    assert.equal(defaults.discordChannelId, null);
    assert.deepEqual(defaults.taskReminderOffsetsMinutes, [1440, 60]);
    assert.deepEqual(defaults.runOfShowReminderOffsetsMinutes, [30]);
    assert.equal(defaults.overdueEnabled, true);

    const updateResponse = await request("PUT", `/api/events/${event.id}/notifications`, authorization, {
      enabled: true,
      discordChannelId: "123456789012345678",
      taskReminderOffsetsMinutes: [60, 1440, 60],
      runOfShowReminderOffsetsMinutes: [30],
      overdueEnabled: false,
    });
    assert.equal(updateResponse.statusCode, 200);
    const updated = json<{
      enabled: boolean;
      discordChannelId: string | null;
      taskReminderOffsetsMinutes: number[];
      runOfShowReminderOffsetsMinutes: number[];
      overdueEnabled: boolean;
    }>(updateResponse);
    assert.equal(updated.enabled, true);
    assert.equal(updated.discordChannelId, "123456789012345678");
    assert.deepEqual(updated.taskReminderOffsetsMinutes, [1440, 60]);
    assert.deepEqual(updated.runOfShowReminderOffsetsMinutes, [30]);
    assert.equal(updated.overdueEnabled, false);
  });
});
