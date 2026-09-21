import type { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../env.js";
import { sendVolunteerEmail } from "../lib/mailer.js";

export async function deliverVolunteerEmails(db: PrismaClient, logger: Pick<FastifyBaseLogger, "warn">, send = sendVolunteerEmail) {
  const jobs = await db.volunteerEmail.findMany({ where: { sentAt: null, availableAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 25 });
  for (const job of jobs) {
    // A lease permits retries after a process restart and prevents two workers sending together.
    const claimed = await db.volunteerEmail.updateMany({ where: { id: job.id, sentAt: null, availableAt: { lte: new Date() } },
      data: { availableAt: new Date(Date.now() + 5 * 60_000), attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      const app = await db.volunteerApplication.findUnique({ where: { id: job.applicationId }, include: { person: true, event: { include: { workspace: true, volunteerForm: true } } } });
      const email = app && (app.email || app.person.email);
      const pendingPlanning = job.kind !== "PLANNING" && job.kind !== "SHIFT_UPDATE" || (app && await db.shift.count({ where: { eventId: app.eventId, assigneeId: app.personId, confirmationStatus: "PENDING", startsAt: { gt: new Date() } } }) > 0);
      if (app && email && pendingPlanning && !app.person.archivedAt && (job.kind === "REGISTERED" || (app.status === "APPROVED" && app.accessToken && !["DONE", "ARCHIVED"].includes(app.event.status)))) {
        await send(email, {
          kind: job.kind as "REGISTERED" | "APPROVED" | "PLANNING" | "SHIFT_UPDATE", fullName: app.person.fullName,
          eventName: app.event.name, associationName: app.event.workspace.name,
          primaryColor: app.event.workspace.emailPrimaryColor,
          logoUrl: app.event.workspace.logoUrl ? new URL(app.event.workspace.logoUrl, env.FRONTEND_URL).href : null,
          portalUrl: app.accessToken ? new URL(`/volunteers/portal/${app.accessToken}`, env.FRONTEND_URL).href : undefined,
          confirmationMessage: app.event.volunteerForm?.confirmationMessage,
        }, job.id);
      }
      await db.volunteerEmail.update({ where: { id: job.id }, data: { sentAt: new Date() } });
    } catch {
      logger.warn({ deliveryId: job.id }, "Volunteer email delivery failed; retry scheduled");
      await db.volunteerEmail.updateMany({ where: { id: job.id, sentAt: null }, data: { availableAt: new Date(Date.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(job.attempts, 7))) } });
    }
  }
}

export function startVolunteerEmailWorker(db: PrismaClient, logger: FastifyBaseLogger) {
  let active: Promise<void> | undefined;
  const tick = () => {
    if (active) return;
    active = deliverVolunteerEmails(db, logger).catch(() => logger.warn("Volunteer email queue unavailable")).finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, 15_000);
  tick();
  return { stop: async () => { clearInterval(timer); await active; } };
}
