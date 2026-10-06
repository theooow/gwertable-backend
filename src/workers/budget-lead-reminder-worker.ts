import type { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../env.js";
import { sendBudgetTrialReminderEmail, type BudgetTrialReminder } from "../lib/mailer.js";
import { budgetTrialSchema } from "../schemas/budget-trial.js";

const HOUR_MS = 3600_000;
const REMIND_AFTER_MS = 24 * HOUR_MS;
// Older trials are left alone: a reminder weeks later reads as spam, e.g. right after the first deploy.
const REMIND_UNTIL_MS = 7 * 24 * HOUR_MS;

function breakEvenTickets(trial: unknown): { eventName: string | null; breakEvenTickets: number | null } {
  const parsed = budgetTrialSchema.safeParse(trial);
  if (!parsed.success) return { eventName: null, breakEvenTickets: null };
  const { eventName, ticketPriceCents, barSpendPerPersonCents, venueCents, artistsCents, techCommsCents } = parsed.data;
  const perAttendee = ticketPriceCents + barSpendPerPersonCents;
  return { eventName: eventName || null, breakEvenTickets: perAttendee > 0 ? Math.ceil((venueCents + artistsCents + techCommsCents) / perAttendee) : null };
}

/** Sends one reminder per email, for its latest trial, when no account was created within 24 hours. */
export async function remindAbandonedBudgetTrials(db: PrismaClient, logger: Pick<FastifyBaseLogger, "warn">, now = new Date(), send: (reminder: BudgetTrialReminder) => Promise<void> = sendBudgetTrialReminderEmail) {
  const due = await db.budgetLead.findMany({
    where: { createdAt: { lte: new Date(now.getTime() - REMIND_AFTER_MS), gte: new Date(now.getTime() - REMIND_UNTIL_MS) }, reminderSentAt: null, convertedAt: null, unsubscribedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const emails = [...new Set(due.map((lead) => lead.email))];
  const [handled, users] = await Promise.all([
    db.budgetLead.findMany({ where: { email: { in: emails }, OR: [{ reminderSentAt: { not: null } }, { unsubscribedAt: { not: null } }, { convertedAt: { not: null } }] }, select: { email: true } }),
    db.user.findMany({ where: { email: { in: emails, mode: "insensitive" } }, select: { email: true } }),
  ]);
  const skipped = new Set([...handled.map((lead) => lead.email), ...users.map((user) => user.email.toLowerCase())]);

  let sent = 0;
  for (const email of emails) {
    if (skipped.has(email)) continue;
    const lead = due.find((candidate) => candidate.email === email)!;
    const claimed = await db.budgetLead.updateMany({ where: { id: lead.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (!claimed.count) continue;
    try {
      await send({
        email,
        resumeUrl: new URL(`/essai-budget?t=${lead.token}`, env.FRONTEND_URL).href,
        unsubscribeUrl: new URL(`/essai-budget/desinscription?t=${lead.token}`, env.FRONTEND_URL).href,
        ...breakEvenTickets(lead.trial),
      });
      sent += 1;
    } catch {
      logger.warn({ leadId: lead.id }, "Budget trial reminder failed; retry scheduled");
      await db.budgetLead.update({ where: { id: lead.id }, data: { reminderSentAt: null } });
    }
  }
  return { sent };
}

export function startBudgetLeadReminderWorker(db: PrismaClient, logger: FastifyBaseLogger) {
  let active: Promise<unknown> | undefined;
  const tick = () => {
    if (active) return;
    active = remindAbandonedBudgetTrials(db, logger).catch(() => logger.warn("Budget trial reminders unavailable")).finally(() => { active = undefined; });
  };
  const interval = setInterval(tick, 15 * 60_000);
  interval.unref();
  tick();
  return { stop: () => clearInterval(interval) };
}
