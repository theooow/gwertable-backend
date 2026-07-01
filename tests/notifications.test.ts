import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
import { ReminderWorkerService } from "../src/services/reminder-worker.service.js";
import type { DiscordMessage, DiscordSender } from "../src/lib/discord.js";
import type { WhatsAppMessage, WhatsAppSender } from "../src/lib/whatsapp.js";

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
      hasDiscordBotToken: boolean;
      discordBotToken?: string | null;
      whatsappEnabled: boolean;
      taskReminderOffsetsMinutes: number[];
      runOfShowReminderOffsetsMinutes: number[];
      overdueEnabled: boolean;
    }>(defaultsResponse);
    assert.equal(defaults.enabled, false);
    assert.equal(defaults.discordChannelId, null);
    assert.equal(defaults.hasDiscordBotToken, false);
    assert.equal(defaults.discordBotToken, undefined);
    assert.equal(defaults.whatsappEnabled, false);
    assert.deepEqual(defaults.taskReminderOffsetsMinutes, [1440, 60]);
    assert.deepEqual(defaults.runOfShowReminderOffsetsMinutes, [30]);
    assert.equal(defaults.overdueEnabled, true);

    const updateResponse = await request("PUT", `/api/events/${event.id}/notifications`, authorization, {
      enabled: true,
      discordChannelId: "123456789012345678",
      discordBotToken: "test-discord-token",
      whatsappEnabled: false,
      taskReminderOffsetsMinutes: [60, 1440, 60],
      runOfShowReminderOffsetsMinutes: [30],
      overdueEnabled: false,
    });
    assert.equal(updateResponse.statusCode, 200);
    const updated = json<{
      enabled: boolean;
      discordChannelId: string | null;
      hasDiscordBotToken: boolean;
      discordBotToken?: string | null;
      whatsappEnabled: boolean;
      taskReminderOffsetsMinutes: number[];
      runOfShowReminderOffsetsMinutes: number[];
      overdueEnabled: boolean;
    }>(updateResponse);
    assert.equal(updated.enabled, true);
    assert.equal(updated.discordChannelId, "123456789012345678");
    assert.equal(updated.hasDiscordBotToken, true);
    assert.equal(updated.discordBotToken, undefined);
    assert.equal(updated.whatsappEnabled, false);
    assert.deepEqual(updated.taskReminderOffsetsMinutes, [1440, 60]);
    assert.deepEqual(updated.runOfShowReminderOffsetsMinutes, [30]);
    assert.equal(updated.overdueEnabled, false);
  });

  it("blocks whatsapp notifications on non premium plans", async () => {
    const { authorization } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);

    const response = await request("PUT", `/api/events/${event.id}/notifications`, authorization, {
      enabled: true,
      discordChannelId: "",
      whatsappEnabled: true,
      taskReminderOffsetsMinutes: [60],
      runOfShowReminderOffsetsMinutes: [30],
      overdueEnabled: false,
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.body, /plan Platinium/);
  });

  it("sends due discord reminders once for tasks and run of show items", async () => {
    const { authorization } = await seedAdminSession();
    const { event, person } = await seedEventContext(authorization);
    await prisma.person.update({
      where: { id: person.id },
      data: { discordUserId: "123456789012345678" },
    });

    await request("POST", `/api/events/${event.id}/participants`, authorization, {
      personId: person.id,
      roles: ["STAFF"],
      rsvpStatus: "YES",
      plusOnes: 0,
      dietary: "",
      setStart: "",
      setEnd: "",
      fee: "",
      contractSigned: false,
      internalNotes: "",
    });

    const now = new Date("2026-06-01T17:00:00.000Z");
    const taskResponse = await request("POST", `/api/events/${event.id}/tasks`, authorization, {
      title: "Prepare bar",
      description: "",
      category: "bar",
      status: "TODO",
      priority: "HIGH",
      dueAt: "2026-06-01T18:00:00.000Z",
      assigneeId: person.id,
    });
    assert.equal(taskResponse.statusCode, 201);

    const runOfShowResponse = await request("POST", `/api/events/${event.id}/run-of-show`, authorization, {
      startsAt: "2026-06-01T17:30:00.000Z",
      durationMin: 30,
      title: "Open doors",
      responsible: "",
      responsiblePersonId: person.id,
      notes: "",
    });
    assert.equal(runOfShowResponse.statusCode, 201);

    await request("PUT", `/api/events/${event.id}/notifications`, authorization, {
      enabled: true,
      discordChannelId: "987654321098765432",
      discordBotToken: "event-discord-token",
      whatsappEnabled: false,
      taskReminderOffsetsMinutes: [1440, 60],
      runOfShowReminderOffsetsMinutes: [30],
      overdueEnabled: true,
    });

    const sentMessages: DiscordMessage[] = [];
    const discord: DiscordSender = {
      async sendMessage(message) {
        sentMessages.push(message);
      },
    };
    const worker = new ReminderWorkerService(prisma, discord);

    const firstRun = await worker.runDueReminders(now);
    assert.equal(firstRun.sent, 2);
    assert.equal(firstRun.skipped, 0);
    assert.equal(sentMessages.length, 2);
    assert.equal(sentMessages.every((message) => message.channelId === "987654321098765432"), true);
    assert.equal(sentMessages.every((message) => message.botToken === "event-discord-token"), true);
    assert.equal(sentMessages.every((message) => message.content.includes("<@123456789012345678>")), true);
    assert.equal(sentMessages.some((message) => message.content.includes("Prepare bar")), true);
    assert.equal(sentMessages.some((message) => message.content.includes("Open doors")), true);

    const secondRun = await worker.runDueReminders(now);
    assert.equal(secondRun.sent, 0);
    assert.equal(secondRun.skipped, 2);

    const deliveries = await prisma.notificationDelivery.findMany({
      where: { eventId: event.id },
      orderBy: { targetType: "asc" },
    });
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries.every((delivery) => delivery.status === "SENT"), true);
  });

  it("sends direct whatsapp reminders to assigned people", async () => {
    const { authorization, user } = await seedAdminSession();
    const { event, person } = await seedEventContext(authorization);
    await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PLATINIUM" } });
    await prisma.person.update({
      where: { id: person.id },
      data: { phone: "+33 6 12 34 56 78", discordUserId: null },
    });

    const now = new Date("2026-06-01T17:00:00.000Z");
    const taskResponse = await request("POST", `/api/events/${event.id}/tasks`, authorization, {
      title: "Prepare cash desk",
      description: "",
      category: "billetterie",
      status: "TODO",
      priority: "HIGH",
      dueAt: "2026-06-01T18:00:00.000Z",
      assigneeId: person.id,
    });
    assert.equal(taskResponse.statusCode, 201);

    await request("PUT", `/api/events/${event.id}/notifications`, authorization, {
      enabled: true,
      discordChannelId: "",
      whatsappEnabled: true,
      taskReminderOffsetsMinutes: [60],
      runOfShowReminderOffsetsMinutes: [30],
      overdueEnabled: false,
    });

    const discord: DiscordSender = {
      async sendMessage() {
        throw new Error("Discord should not be called");
      },
    };
    const sentMessages: WhatsAppMessage[] = [];
    const whatsapp: WhatsAppSender = {
      async sendMessage(message) {
        sentMessages.push(message);
      },
    };
    const worker = new ReminderWorkerService(prisma, discord, whatsapp);

    const firstRun = await worker.runDueReminders(now);
    assert.equal(firstRun.sent, 1);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0]?.to, "+33 6 12 34 56 78");
    assert.match(sentMessages[0]?.content ?? "", /Prepare cash desk/);
    assert.doesNotMatch(sentMessages[0]?.content ?? "", /<@/);

    const secondRun = await worker.runDueReminders(now);
    assert.equal(secondRun.sent, 0);
    assert.equal(secondRun.skipped, 1);

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { eventId: event.id, channel: "WHATSAPP" },
    });
    assert.equal(delivery.status, "SENT");
  });
});
