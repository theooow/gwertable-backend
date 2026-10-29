import type { PrismaClient } from "@prisma/client";

export type UnconvertedLead = {
  email: string;
  firstTriedAt: Date;
  lastTriedAt: Date;
  trials: number;
  eventName: string | null;
  trialCompleted: boolean;
  reminderSentAt: Date | null;
  unsubscribed: boolean;
};

function eventNameOf(trial: unknown): string | null {
  const name = (trial as { eventName?: unknown } | null)?.eventName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** People who tried the budget dashboard and never got an account, one row per email, most recent first. */
export async function getUnconvertedBudgetLeads(prisma: PrismaClient): Promise<UnconvertedLead[]> {
  const leads = await prisma.budgetLead.findMany({
    orderBy: { createdAt: "desc" },
    select: { email: true, trial: true, trialCompletedAt: true, reminderSentAt: true, unsubscribedAt: true, convertedAt: true, createdAt: true },
  });
  const emails = [...new Set(leads.map((lead) => lead.email.toLowerCase()))];
  // A visitor may sign up without claiming their trial, so an existing account also counts as converted.
  const accounts = await prisma.user.findMany({ where: { email: { in: emails, mode: "insensitive" } }, select: { email: true } });
  const converted = new Set([...accounts.map((user) => user.email.toLowerCase()), ...leads.filter((lead) => lead.convertedAt).map((lead) => lead.email.toLowerCase())]);

  const byEmail = new Map<string, UnconvertedLead>();
  for (const lead of leads) {
    const key = lead.email.toLowerCase();
    if (converted.has(key)) continue;
    const row = byEmail.get(key);
    if (!row) {
      byEmail.set(key, { email: lead.email, firstTriedAt: lead.createdAt, lastTriedAt: lead.createdAt, trials: 1, eventName: eventNameOf(lead.trial),
        trialCompleted: Boolean(lead.trialCompletedAt), reminderSentAt: lead.reminderSentAt, unsubscribed: Boolean(lead.unsubscribedAt) });
      continue;
    }
    row.firstTriedAt = lead.createdAt;
    row.trials += 1;
    row.eventName ??= eventNameOf(lead.trial);
    row.trialCompleted ||= Boolean(lead.trialCompletedAt);
    row.reminderSentAt ??= lead.reminderSentAt;
    row.unsubscribed ||= Boolean(lead.unsubscribedAt);
  }
  return [...byEmail.values()];
}
