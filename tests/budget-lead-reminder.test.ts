import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
import { remindAbandonedBudgetTrials } from "../src/workers/budget-lead-reminder-worker.js";
import type { BudgetTrialReminder } from "../src/lib/mailer.js";

setupTestApp();

const HOUR_MS = 3600_000;
const now = new Date("2026-10-10T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR_MS);
const logger = { warn: () => undefined };
const trial = { eventName: "Rentrée", ticketPriceCents: 1000, capacity: 200, venueCents: 100000, artistsCents: 50000, techCommsCents: 0, barSpendPerPersonCents: 500 };

const lead = (email: string, token: string, createdAt: Date, extra: object = {}) =>
  prisma.budgetLead.create({ data: { email, token: `${token}-token-0000000`, createdAt, ...extra } });

describe("budget trial reminders", () => {
  it("reminds once per email, for the latest abandoned trial, after 24 hours", async () => {
    await lead("orga@asso.test", "old", hoursAgo(30));
    await lead("orga@asso.test", "latest", hoursAgo(25), { trial });
    await lead("fresh@asso.test", "fresh", hoursAgo(2));
    await lead("stale@asso.test", "stale", hoursAgo(24 * 8));
    await lead("gone@asso.test", "gone", hoursAgo(30));
    await lead("gone@asso.test", "gone2", hoursAgo(40), { unsubscribedAt: hoursAgo(39) });
    await lead("member@asso.test", "member", hoursAgo(30));
    await prisma.user.create({ data: { email: "Member@asso.test" } });

    const sent: BudgetTrialReminder[] = [];
    assert.deepEqual(await remindAbandonedBudgetTrials(prisma, logger, now, async (reminder) => { sent.push(reminder); }), { sent: 1 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, "orga@asso.test");
    assert.match(sent[0].resumeUrl, /\/essai-budget\?t=latest-token/);
    assert.match(sent[0].unsubscribeUrl, /\/essai-budget\/desinscription\?t=latest-token/);
    assert.equal(sent[0].eventName, "Rentrée");
    assert.equal(sent[0].breakEvenTickets, 100);

    assert.deepEqual(await remindAbandonedBudgetTrials(prisma, logger, now, async (reminder) => { sent.push(reminder); }), { sent: 0 });
  });

  it("retries a reminder whose delivery failed", async () => {
    await lead("orga@asso.test", "retry", hoursAgo(25));
    await remindAbandonedBudgetTrials(prisma, logger, now, async () => { throw new Error("smtp down"); });
    assert.equal((await prisma.budgetLead.findFirstOrThrow()).reminderSentAt, null);
    assert.deepEqual(await remindAbandonedBudgetTrials(prisma, logger, now, async () => undefined), { sent: 1 });
  });
});
