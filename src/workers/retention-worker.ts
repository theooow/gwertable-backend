import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";

const DAY_MS = 24 * 3600_000;
const YEAR_MS = 365 * DAY_MS;
// Durations announced in the privacy policy and the data processing agreement.
const APPLICATION_RETENTION_MS = YEAR_MS;
const DEFAULT_CONTRACT_RETENTION_YEARS = 3;

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

export function startRetentionWorker(db: PrismaClient, logger: FastifyBaseLogger) {
  let active: Promise<unknown> | undefined;
  const tick = () => {
    if (active) return;
    active = purgeVolunteerData(db)
      .catch(() => logger.error("Retention purge failed"))
      .finally(() => { active = undefined; });
  };
  const interval = setInterval(tick, DAY_MS / 4);
  interval.unref();
  tick();
  return { stop: () => clearInterval(interval) };
}
