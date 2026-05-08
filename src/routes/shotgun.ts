import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCan } from "../lib/permissions.js";
import { fetchShotgunEventsForSearch, getShotgunWorkspaceConfig } from "../lib/shotgun.js";

const shotgunEventsQuerySchema = z.object({
  name: z.string().optional(),
});

export async function shotgunRoutes(fastify: FastifyInstance) {
  fastify.get("/api/shotgun/events", async (request) => {
    requireCan(request.userRole, "event.read");
    const query = shotgunEventsQuerySchema.parse(request.query);
    const config = await getShotgunWorkspaceConfig(request.workspaceId);
    const search = query.name?.trim() || "";
    if (!search) {
      return { events: [] };
    }
    const events = await fetchShotgunEventsForSearch(config, search);

    return {
      events: events.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    };
  });
}
