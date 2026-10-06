import type { PrismaClient } from "@prisma/client";
import { ADMIN_EMAIL } from "../lib/admin.js";
import { visibleActivityTypes } from "../lib/activity-catalog.js";
import { manualExpense } from "./admin-kpi.repository.js";

const DAY_MS = 86400000;
const BUDGET_TYPES = visibleActivityTypes("ADMIN", ["budget"]);
const BUDGET_LINE_TYPES = ["EXPENSE_CREATED", "EXPENSE_IMPORTED", "INCOME_CREATED", "INCOME_IMPORTED", "TICKET_TIER_CREATED", "TICKETING_SYNCED", "CONSUMABLE_CREATED"];
const INVITE_TYPES = ["MEMBER_INVITED", "COLLABORATOR_INVITED"];

export const FUNNEL_PERIODS = ["30", "90", "365", "all"] as const;
export type FunnelPeriod = (typeof FUNNEL_PERIODS)[number];

type Stage = "acquisition" | "activation" | "retention" | "referral" | "revenue";
type UserStep = "verified" | "eventCreated" | "budgetOpened" | "firstBudgetLine" | "budgetComplete"
  | "returnedLaterDay" | "active7d" | "active30d" | "invited" | "inviteAccepted" | "exported" | "multiEvent";

const USER_STEPS: { key: UserStep; stage: Stage; label: string; minAgeDays?: number }[] = [
  { key: "verified", stage: "activation", label: "Email vérifié" },
  { key: "eventCreated", stage: "activation", label: "Premier événement" },
  { key: "budgetOpened", stage: "activation", label: "Budget ouvert" },
  { key: "firstBudgetLine", stage: "activation", label: "Première ligne de budget" },
  { key: "budgetComplete", stage: "activation", label: "Budget complet (dépense + recette)" },
  { key: "returnedLaterDay", stage: "retention", label: "Revenu sur le budget un autre jour", minAgeDays: 1 },
  { key: "active7d", stage: "retention", label: "Actif sur le budget 7 j après", minAgeDays: 7 },
  { key: "active30d", stage: "retention", label: "Actif sur le budget 30 j après", minAgeDays: 30 },
  { key: "invited", stage: "referral", label: "A invité un membre" },
  { key: "inviteAccepted", stage: "referral", label: "Invitation acceptée" },
  { key: "exported", stage: "revenue", label: "Budget ou compta exporté" },
  { key: "multiEvent", stage: "revenue", label: "Budget sur 2 événements ou plus" },
];
/** Activation is sequential: reaching a later step implies the earlier ones (e.g. budget lines added before view tracking existed). */
const ACTIVATION_CHAIN: UserStep[] = ["eventCreated", "budgetOpened", "firstBudgetLine", "budgetComplete"];

type Touch = { at: Date; eventId: string | null };
type UserJourney = { touches: Touch[]; budgetEvents: Set<string>; firstLineAt: Date | null; steps: Set<UserStep>; anonymousIds: Set<string> };

function sourceOf(properties: unknown): string {
  const source = (properties as { source?: unknown } | null)?.source;
  return typeof source === "string" && source ? source : "direct";
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

export async function getBudgetFunnel(prisma: PrismaClient, period: FunnelPeriod, now = new Date()) {
  const since = period === "all" ? null : new Date(now.getTime() - Number(period) * DAY_MS);
  const users = await prisma.user.findMany({
    where: { archivedAt: null, email: { not: ADMIN_EMAIL }, ...(since ? { createdAt: { gte: since } } : {}) },
    select: { id: true, createdAt: true, emailVerified: true },
  });
  const userIds = users.map((user) => user.id);

  const [activities, signals, firstSignal] = await Promise.all([
    prisma.activityEntry.findMany({
      where: { actorId: { in: userIds }, type: { in: ["EVENT_CREATED", ...INVITE_TYPES, ...BUDGET_TYPES] } },
      select: { actorId: true, type: true, workspaceId: true, eventId: true, createdAt: true },
    }),
    prisma.trackingEvent.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, name: true, anonymousId: true, eventId: true, createdAt: true },
    }),
    prisma.trackingEvent.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const journeys = new Map<string, UserJourney>(users.map((user) => [user.id, {
    touches: [], budgetEvents: new Set(), firstLineAt: null, anonymousIds: new Set(),
    steps: new Set<UserStep>(user.emailVerified ? ["verified"] : []),
  }]));
  const invitedScopes: { userId: string; workspaceId: string | null; eventId: string | null; at: Date }[] = [];

  for (const activity of activities) {
    const journey = journeys.get(activity.actorId!);
    if (!journey) continue;
    if (activity.type === "EVENT_CREATED") journey.steps.add("eventCreated");
    else if (INVITE_TYPES.includes(activity.type)) {
      journey.steps.add("invited");
      invitedScopes.push({ userId: activity.actorId!, at: activity.createdAt,
        workspaceId: activity.type === "MEMBER_INVITED" ? activity.workspaceId : null, eventId: activity.type === "COLLABORATOR_INVITED" ? activity.eventId : null });
    } else {
      journey.touches.push({ at: activity.createdAt, eventId: activity.eventId });
      if (BUDGET_LINE_TYPES.includes(activity.type)) {
        if (!journey.firstLineAt || activity.createdAt < journey.firstLineAt) journey.firstLineAt = activity.createdAt;
        if (activity.eventId) journey.budgetEvents.add(activity.eventId);
      }
    }
  }
  for (const signal of signals) {
    const journey = journeys.get(signal.userId!);
    if (!journey) continue;
    if (signal.anonymousId) journey.anonymousIds.add(signal.anonymousId);
    if (signal.name === "budget_exported") journey.steps.add("exported");
    if (signal.name.startsWith("budget_")) {
      journey.steps.add("budgetOpened");
      journey.touches.push({ at: signal.createdAt, eventId: signal.eventId });
    }
  }

  const budgetEventIds = [...new Set([...journeys.values()].flatMap((journey) => [...journey.budgetEvents]))];
  const anonymousIds = [...new Set([...journeys.values()].flatMap((journey) => [...journey.anonymousIds]))];
  const [budgetEvents, acceptedMembers, acceptedCollaborators, landings] = await Promise.all([
    prisma.event.findMany({
      where: { id: { in: budgetEventIds } },
      select: { id: true, _count: { select: { expenses: { where: manualExpense }, incomes: true, ticketTiers: { where: { archivedAt: null } } } } },
    }),
    prisma.workspaceInvitation.findMany({
      where: { workspaceId: { in: invitedScopes.flatMap((scope) => scope.workspaceId ?? []) }, acceptedAt: { not: null } },
      select: { workspaceId: true, acceptedAt: true },
    }),
    prisma.eventCollaborator.findMany({
      where: { eventId: { in: invitedScopes.flatMap((scope) => scope.eventId ?? []) }, acceptedAt: { not: null } },
      select: { eventId: true, acceptedAt: true },
    }),
    prisma.trackingEvent.findMany({
      where: { name: "landing_viewed", ...(since ? { OR: [{ anonymousId: { in: anonymousIds } }, { createdAt: { gte: since } }] } : {}) },
      orderBy: { createdAt: "asc" },
      select: { anonymousId: true, properties: true, createdAt: true },
    }),
  ]);

  const completeEvents = new Set(budgetEvents.filter(({ _count: count }) => count.expenses > 0 && count.incomes + count.ticketTiers > 0).map((event) => event.id));
  for (const scope of invitedScopes) {
    const accepted = scope.workspaceId
      ? acceptedMembers.some((invite) => invite.workspaceId === scope.workspaceId && invite.acceptedAt! >= scope.at)
      : acceptedCollaborators.some((invite) => invite.eventId === scope.eventId && invite.acceptedAt! >= scope.at);
    if (accepted) journeys.get(scope.userId)!.steps.add("inviteAccepted");
  }

  const hoursToFirstLine: number[] = [];
  for (const user of users) {
    const journey = journeys.get(user.id)!;
    if (journey.firstLineAt) {
      const first = journey.firstLineAt;
      journey.steps.add("firstBudgetLine");
      hoursToFirstLine.push((first.getTime() - user.createdAt.getTime()) / 3600000);
      const firstDay = first.toISOString().slice(0, 10);
      if (journey.touches.some((touch) => touch.at > first && touch.at.toISOString().slice(0, 10) !== firstDay)) journey.steps.add("returnedLaterDay");
      if (journey.touches.some((touch) => touch.at.getTime() >= first.getTime() + 7 * DAY_MS)) journey.steps.add("active7d");
      if (journey.touches.some((touch) => touch.at.getTime() >= first.getTime() + 30 * DAY_MS)) journey.steps.add("active30d");
    }
    if ([...journey.budgetEvents].some((eventId) => completeEvents.has(eventId))) journey.steps.add("budgetComplete");
    if (journey.budgetEvents.size >= 2) journey.steps.add("multiEvent");
    for (let index = ACTIVATION_CHAIN.length - 1; index > 0; index -= 1) {
      if (journey.steps.has(ACTIVATION_CHAIN[index])) journey.steps.add(ACTIVATION_CHAIN[index - 1]);
    }
  }

  const firstLanding = new Map<string, { source: string; at: Date }>();
  for (const landing of landings) {
    if (landing.anonymousId && !firstLanding.has(landing.anonymousId)) firstLanding.set(landing.anonymousId, { source: sourceOf(landing.properties), at: landing.createdAt });
  }
  const sources = new Map<string, { visitors: number; signups: number; activated: number }>();
  const sourceRow = (source: string) => sources.get(source) ?? sources.set(source, { visitors: 0, signups: 0, activated: 0 }).get(source)!;
  for (const visit of firstLanding.values()) if (!since || visit.at >= since) sourceRow(visit.source).visitors += 1;
  for (const journey of journeys.values()) {
    const origin = [...journey.anonymousIds].map((id) => firstLanding.get(id)).filter((visit) => visit !== undefined).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
    const row = sourceRow(origin?.source ?? "inconnue");
    row.signups += 1;
    if (journey.steps.has("firstBudgetLine")) row.activated += 1;
  }

  const visitors = [...firstLanding.values()].filter((visit) => !since || visit.at >= since).length;
  const journeyList = users.map((user) => ({ createdAt: user.createdAt, journey: journeys.get(user.id)! }));
  return {
    generatedAt: now.toISOString(),
    period,
    since: since?.toISOString() ?? null,
    trackingSince: firstSignal?.createdAt.toISOString() ?? null,
    medianHoursToFirstBudgetLine: median(hoursToFirstLine),
    steps: [
      { key: "visited", stage: "acquisition" as Stage, label: "Visite de la page d'accueil", users: visitors, eligible: null },
      { key: "signedUp", stage: "acquisition" as Stage, label: "Compte créé", users: users.length, eligible: null },
      ...USER_STEPS.map((step) => {
        // Retention is only measurable once the user had enough time to come back.
        const mature = step.minAgeDays === undefined ? journeyList : journeyList.filter(({ journey }) =>
          journey.firstLineAt && journey.firstLineAt.getTime() <= now.getTime() - step.minAgeDays! * DAY_MS);
        return { key: step.key, stage: step.stage, label: step.label,
          users: mature.filter(({ journey }) => journey.steps.has(step.key)).length,
          eligible: step.minAgeDays === undefined ? null : mature.length };
      }),
    ],
    sources: [...sources].map(([source, row]) => ({ source, ...row })).sort((a, b) => b.signups - a.signups || b.visitors - a.visitors),
  };
}
