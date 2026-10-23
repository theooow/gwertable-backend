import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../env.js";
import { sendInactivityWarningEmail } from "../lib/mailer.js";
import { removeUploadedFiles } from "../lib/upload-files.js";
import { anonymizeWorkspace } from "../lib/workspace-anonymization.js";

const DAY_MS = 24 * 3600_000;
const YEAR_MS = 365 * DAY_MS;
// Durations announced in the privacy policy and the data processing agreement.
const APPLICATION_RETENTION_MS = YEAR_MS;
const DEFAULT_CONTRACT_RETENTION_YEARS = 3;
const INACTIVITY_MS = 3 * YEAR_MS;
const INACTIVITY_NOTICE_MS = 30 * DAY_MS;
// A paying customer is never deleted for inactivity.
const PAYING_STATUSES = ["active", "trialing", "past_due", "unpaid"];

const inactiveSince = (cutoff: Date): Prisma.UserWhereInput => ({
  lastSeenAt: { lt: cutoff },
  OR: [{ subscriptionStatus: null }, { subscriptionStatus: { notIn: PAYING_STATUSES } }],
});

const endedBefore = (cutoff: Date): Prisma.EventWhereInput => ({
  OR: [{ endsAt: { lt: cutoff } }, { endsAt: null, startsAt: { lt: cutoff } }],
});

function contractRetentionYears(snapshot: Prisma.JsonValue, fallback: number | undefined) {
  const years = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot.retentionYears : undefined;
  return typeof years === "number" && years > 0 ? years : fallback ?? DEFAULT_CONTRACT_RETENTION_YEARS;
}

/**
 * Removes volunteer contracts once the retention chosen by the organisation has elapsed after the event,
 * then applications and dietary preferences one year after the event. Contacts stay in the address book.
 */
export async function purgeVolunteerData(db: PrismaClient, now = new Date()) {
  const contracts = await db.volunteerContract.findMany({
    where: { event: endedBefore(new Date(now.getTime() - YEAR_MS)) },
    select: { id: true, snapshot: true, event: { select: { startsAt: true, endsAt: true, volunteerForm: { select: { contractRetentionYears: true } } } } },
  });
  const expiredContracts = contracts.filter(({ snapshot, event }) => {
    const years = contractRetentionYears(snapshot, event.volunteerForm?.contractRetentionYears);
    return (event.endsAt ?? event.startsAt).getTime() + years * YEAR_MS < now.getTime();
  }).map((c) => c.id);
  const cutoff = new Date(now.getTime() - APPLICATION_RETENTION_MS);
  return db.$transaction(async (tx) => {
    const deletedContracts = await tx.volunteerContract.deleteMany({ where: { id: { in: expiredContracts } } });
    const deletedApplications = await tx.volunteerApplication.deleteMany({ where: { event: endedBefore(cutoff), contracts: { none: {} } } });
    await tx.eventParticipant.updateMany({ where: { event: endedBefore(cutoff), dietary: { not: null } }, data: { dietary: null } });
    return { contracts: deletedContracts.count, applications: deletedApplications.count };
  });
}

/** Emails accounts approaching three years without login, once, at least 30 days before deletion. */
export async function warnInactiveAccounts(db: PrismaClient, logger?: FastifyBaseLogger, now = new Date()) {
  const users = await db.user.findMany({
    where: { ...inactiveSince(new Date(now.getTime() - INACTIVITY_MS + INACTIVITY_NOTICE_MS)), inactivityWarnedAt: null },
    select: { id: true, email: true, lastSeenAt: true },
    take: 100,
  });
  let warned = 0;
  for (const user of users) {
    const deletionDate = new Date(Math.max(user.lastSeenAt.getTime() + INACTIVITY_MS, now.getTime() + INACTIVITY_NOTICE_MS));
    try {
      await sendInactivityWarningEmail({ email: user.email, loginUrl: new URL("/login", env.FRONTEND_URL).href, deletionDate });
    } catch {
      logger?.warn("Inactivity warning email failed");
      continue;
    }
    await db.user.update({ where: { id: user.id }, data: { inactivityWarnedAt: now } });
    warned += 1;
  }
  return warned;
}

/**
 * Deletes accounts inactive for three years once warned 30 days ahead. A workspace left without members
 * is anonymised; one left without an admin gets its oldest member promoted.
 */
export async function deleteInactiveAccounts(db: PrismaClient, now = new Date()) {
  const users = await db.user.findMany({
    where: { ...inactiveSince(new Date(now.getTime() - INACTIVITY_MS)), inactivityWarnedAt: { lte: new Date(now.getTime() - INACTIVITY_NOTICE_MS) } },
    select: { id: true, workspaceMemberships: { select: { workspaceId: true } } },
    take: 100,
  });
  for (const user of users) {
    const files = await db.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: user.id } });
      const removed: string[] = [];
      for (const { workspaceId } of user.workspaceMemberships) {
        const members = await tx.workspaceMember.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { id: true, role: true } });
        if (!members.length) removed.push(...await anonymizeWorkspace(tx, workspaceId));
        else if (!members.some((m) => m.role === "ADMIN")) await tx.workspaceMember.update({ where: { id: members[0]!.id }, data: { role: "ADMIN" } });
      }
      return removed;
    });
    await removeUploadedFiles(files);
  }
  return users.length;
}

export function startRetentionWorker(db: PrismaClient, logger: FastifyBaseLogger) {
  let active: Promise<unknown> | undefined;
  const tick = () => {
    if (active) return;
    active = purgeVolunteerData(db)
      .then(() => warnInactiveAccounts(db, logger))
      .then(() => deleteInactiveAccounts(db))
      .catch(() => logger.error("Retention purge failed"))
      .finally(() => { active = undefined; });
  };
  const interval = setInterval(tick, DAY_MS / 4);
  interval.unref();
  tick();
  return { stop: () => clearInterval(interval) };
}
