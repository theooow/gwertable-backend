import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCan } from "../lib/permissions.js";
import { fetchShotgunEvents, getShotgunWorkspaceConfig } from "../lib/shotgun.js";

const shotgunEventsQuerySchema = z.object({
  name: z.string().optional(),
  past_events: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export async function shotgunRoutes(fastify: FastifyInstance) {
  fastify.get("/api/shotgun/events", async (request) => {
    requireCan(request.userRole, "event.read");
    const query = shotgunEventsQuerySchema.parse(request.query);
    const config = await getShotgunWorkspaceConfig(request.workspaceId);
    const events = await fetchShotgunEvents(config, {
      name: query.name?.trim() || undefined,
      pastEvents: query.past_events,
    });

    return {
      events: events.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    };
  });
}
