import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { isAdminEmail } from "../lib/admin.js";
import { NotFoundError } from "../lib/errors.js";
import { APP_TRACKING_EVENTS, TrackingRepository } from "../repositories/tracking.repository.js";

const anonymousId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const shortText = z.string().trim().max(100);

const landingSchema = z.object({
  anonymousId,
  path: z.string().max(200).default("/"),
  referrer: z.string().max(500).optional(),
  utmSource: shortText.optional(),
  utmMedium: shortText.optional(),
  utmCampaign: shortText.optional(),
});

const appEventSchema = z.object({
  name: z.enum(APP_TRACKING_EVENTS),
  anonymousId: anonymousId.optional(),
  eventId: z.string().min(1).max(100).optional(),
  detail: z.string().trim().max(60).optional(),
});

const repository = new TrackingRepository(prisma);

/** Only the referring host is kept: full referrer URLs can carry personal data in their query string. */
function referrerHost(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try { return new URL(referrer).hostname.replace(/^www\./, "") || null; } catch { return null; }
}

export async function trackingRoutes(fastify: FastifyInstance) {
  fastify.post("/api/public/tracking/landing", { config: { documentation: { body: landingSchema, statusCodes: [204] } } }, async (request, reply) => {
    const data = landingSchema.parse(request.body);
    const host = referrerHost(data.referrer);
    await repository.record({
      name: "landing_viewed",
      anonymousId: data.anonymousId,
      properties: {
        path: data.path,
        source: data.utmSource?.toLowerCase() || host || "direct",
        medium: data.utmMedium?.toLowerCase() || (host ? "referral" : "none"),
        campaign: data.utmCampaign ?? null,
        referrerHost: host,
      },
    });
    return reply.status(204).send();
  });

  fastify.post("/api/tracking/events", { config: { documentation: { body: appEventSchema, statusCodes: [204] } } }, async (request, reply) => {
    const data = appEventSchema.parse(request.body);
    const user = request.user!;
    if (data.eventId && !(await repository.eventBelongsToWorkspace(data.eventId, request.workspaceId))) {
      throw new NotFoundError("Événement introuvable");
    }
    // The platform admin browses every workspace: counting them would skew the funnel.
    if (!isAdminEmail(user.email)) {
      await repository.record({
        name: data.name,
        anonymousId: data.anonymousId,
        userId: user.id,
        workspaceId: request.workspaceId,
        eventId: data.eventId,
        properties: data.detail ? { detail: data.detail } : {},
      });
    }
    return reply.status(204).send();
  });
}
