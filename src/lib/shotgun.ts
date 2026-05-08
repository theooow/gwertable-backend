import { z } from "zod";
import { prisma } from "../prisma.js";

const shotgunDealSchema = z.object({
  product_id: z.coerce.number().int(),
  name: z.string(),
  quantity: z.coerce.number().int().nonnegative().default(0),
  price: z.coerce.number(),
  organizer_fees: z.coerce.number().optional().nullable(),
  user_fees: z.coerce.number().optional().nullable(),
});

const shotgunEventSchema = z.object({
  id: z.coerce.number().int(),
  name: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable().optional(),
  slug: z.string().optional().default(""),
  description: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  deals: z.array(shotgunDealSchema).default([]),
});

const shotgunEventsResponseSchema = z.object({
  data: z.array(shotgunEventSchema),
});

const shotgunTicketSchema = z.object({
  ticket_id: z.coerce.number().int(),
  ticket_status: z.enum([
    "valid",
    "resold",
    "refunded",
    "canceled",
    "payment_plan_pending",
    "pending_approval",
    "rejected",
  ]),
  deal_id: z.coerce.number().int(),
});

const shotgunTicketsResponseSchema = z.union([
  z.array(shotgunTicketSchema),
  z.object({ data: z.array(shotgunTicketSchema) }),
]);

export type ShotgunEvent = z.infer<typeof shotgunEventSchema>;
export type ShotgunDeal = z.infer<typeof shotgunDealSchema>;
export type ShotgunTicket = z.infer<typeof shotgunTicketSchema>;

export type ShotgunWorkspaceConfig = {
  organizerId: string;
  apiToken: string;
};

export async function getShotgunWorkspaceConfig(workspaceId: string): Promise<ShotgunWorkspaceConfig> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      shotgunOrganizerId: true,
      shotgunApiToken: true,
    },
  });

  if (!workspace?.shotgunOrganizerId || !workspace.shotgunApiToken) {
    const error = new Error("Shotgun n'est pas configure pour ce workspace");
    error.name = "ValidationError";
    throw error;
  }

  return {
    organizerId: workspace.shotgunOrganizerId,
    apiToken: workspace.shotgunApiToken,
  };
}

type ShotgunEventsQuery = {
  name?: string;
  pastEvents?: boolean;
};

function buildShotgunUrl(base: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchShotgunJson(url: URL) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Shotgun request failed: ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

export async function fetchShotgunEvents(config: ShotgunWorkspaceConfig, query: ShotgunEventsQuery = {}) {
  const url = buildShotgunUrl(
    `https://smartboard-api.shotgun.live/api/shotgun/organizers/${config.organizerId}/events`,
    {
      key: config.apiToken,
      name: query.name,
      past_events: query.pastEvents ? "true" : undefined,
    },
  );

  const payload = await fetchShotgunJson(url);
  const parsed = shotgunEventsResponseSchema.parse(payload);
  return parsed.data;
}

export async function fetchShotgunEventsForSearch(config: ShotgunWorkspaceConfig, query: string) {
  const [futureEvents, pastEvents] = await Promise.all([
    fetchShotgunEvents(config, { name: query }),
    fetchShotgunEvents(config, { name: query, pastEvents: true }),
  ]);

  const all = [...futureEvents, ...pastEvents];
  return all.filter((shotgunEvent, index, array) => array.findIndex((candidate) => candidate.id === shotgunEvent.id) === index);
}

export async function fetchShotgunTickets(config: ShotgunWorkspaceConfig, eventId: number) {
  const url = buildShotgunUrl("https://api.shotgun.live/tickets", {
    token: config.apiToken,
    organizer_id: config.organizerId,
    event_id: eventId,
    include_cohosted_events: 1,
  });

  const payload = await fetchShotgunJson(url);
  const parsed = shotgunTicketsResponseSchema.parse(payload);
  return Array.isArray(parsed) ? parsed : parsed.data;
}

export function groupShotgunSoldTickets(tickets: ShotgunTicket[]) {
  const activeStatuses = new Set(["valid", "resold", "payment_plan_pending", "pending_approval"]);
  const counts = new Map<number, number>();
  for (const ticket of tickets) {
    if (!activeStatuses.has(ticket.ticket_status)) continue;
    counts.set(ticket.deal_id, (counts.get(ticket.deal_id) ?? 0) + 1);
  }
  return counts;
}
