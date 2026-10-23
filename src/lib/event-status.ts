import type { EventStatus } from "@prisma/client";

/** Sans date de fin, un événement est considéré terminé 24 h après son début. */
export const EVENT_DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Statut d'un événement déduit de ses dates : à venir, en cours puis terminé.
 * Seul l'archivage reste une action manuelle.
 */
export function eventStatusForDates(startsAt: Date, endsAt: Date | null, now: Date = new Date()): EventStatus {
  const end = endsAt ?? new Date(startsAt.getTime() + EVENT_DEFAULT_DURATION_MS);
  if (now < startsAt) return "PLANNING";
  return now < end ? "LIVE" : "DONE";
}

/** Statut à enregistrer : l'archivage demandé est conservé, sinon les dates décident. */
export function resolveEventStatus(data: { status: EventStatus; startsAt: string; endsAt?: string }, now: Date = new Date()): EventStatus {
  if (data.status === "ARCHIVED") return "ARCHIVED";
  return eventStatusForDates(new Date(data.startsAt), data.endsAt ? new Date(data.endsAt) : null, now);
}
