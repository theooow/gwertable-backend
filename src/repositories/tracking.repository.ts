import type { Prisma, PrismaClient } from "@prisma/client";

export const APP_TRACKING_EVENTS = ["app_opened", "budget_viewed", "budget_simulated", "budget_exported"] as const;
export type AppTrackingEvent = (typeof APP_TRACKING_EVENTS)[number];
export type TrackingEventName = "landing_viewed" | AppTrackingEvent;

export type TrackingInput = {
  name: TrackingEventName;
  anonymousId?: string | null;
  userId?: string | null;
  workspaceId?: string | null;
  eventId?: string | null;
  properties?: Prisma.InputJsonObject;
};

export class TrackingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: TrackingInput) {
    await this.prisma.trackingEvent.create({ data: { ...input, properties: input.properties ?? {} } });
  }

  async eventBelongsToWorkspace(eventId: string, workspaceId: string) {
    return Boolean(await this.prisma.event.findFirst({ where: { id: eventId, workspaceId }, select: { id: true } }));
  }
}
