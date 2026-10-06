import type { PrismaClient } from "@prisma/client";

const DAY_MS = 86400000;
const MONTHS = 6;

export const ADOPTION_MODULES = ["budget", "ticketing", "tasks", "participants", "volunteers", "runOfShow", "shopping", "equipment"] as const;
export type AdoptionModule = (typeof ADOPTION_MODULES)[number];

type EventCounts = Record<"expenses" | "incomes" | "ticketTiers" | "tasks" | "participants" | "volunteerApplications" | "shifts" | "runOfShow" | "shopping" | "equipmentUsages", number>;

/** Participant fees and equipment rentals create expenses automatically; they do not reflect deliberate budgeting. */
export const manualExpense = { sourceParticipantId: null, isEquipmentSync: false };

function usedModules(counts: EventCounts): Record<AdoptionModule, boolean> {
  return {
    budget: counts.expenses + counts.incomes + counts.ticketTiers > 0,
    ticketing: counts.ticketTiers > 0,
    tasks: counts.tasks > 0,
    participants: counts.participants > 0,
    volunteers: counts.volunteerApplications + counts.shifts > 0,
    runOfShow: counts.runOfShow > 0,
    shopping: counts.shopping > 0,
    equipment: counts.equipmentUsages > 0,
  };
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export async function getAdminKpis(prisma: PrismaClient, now = new Date()) {
  const since30d = new Date(now.getTime() - 30 * DAY_MS);
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1));
  const userActivity = { createdAt: { gte: since30d }, NOT: { route: { startsWith: "/api/admin" } } };

  const [workspaces, events, newUsers, activeUsers, workspaceActivity] = await Promise.all([
    prisma.workspace.findMany({ select: { id: true, name: true, createdAt: true, _count: { select: { members: true } } } }),
    prisma.event.findMany({
      select: {
        workspaceId: true, startsAt: true, endsAt: true, createdAt: true,
        _count: { select: {
          expenses: { where: manualExpense }, incomes: true, ticketTiers: { where: { archivedAt: null } }, tasks: true, participants: true,
          volunteerApplications: true, shifts: true, runOfShow: true, shopping: true, equipmentUsages: true,
        } },
      },
    }),
    prisma.user.findMany({ where: { archivedAt: null, createdAt: { gte: firstMonth } }, select: { createdAt: true } }),
    prisma.apiLog.groupBy({ by: ["userId"], where: { ...userActivity, userId: { not: null } }, _max: { createdAt: true } }),
    prisma.apiLog.groupBy({ by: ["workspaceId"], where: { ...userActivity, workspaceId: { not: null } }, _max: { createdAt: true } }),
  ]);

  const lastActivity = new Map(workspaceActivity.map((row) => [row.workspaceId, row._max.createdAt]));
  const perWorkspace = new Map(workspaces.map((workspace) => [workspace.id, {
    id: workspace.id, name: workspace.name, createdAt: workspace.createdAt.toISOString(), members: workspace._count.members,
    events: 0, budgetedEvents: 0, upcomingEvents: 0, eventsLast30d: 0,
    lastActivityAt: lastActivity.get(workspace.id)?.toISOString() ?? null,
  }]));
  const adoption = Object.fromEntries(ADOPTION_MODULES.map((module) => [module, 0])) as Record<AdoptionModule, number>;
  const monthly = new Map(Array.from({ length: MONTHS }, (_, index) => [
    monthKey(new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + index, 1))),
    { events: 0, budgetedEvents: 0, newUsers: 0 },
  ]));

  let budgetedEvents = 0;
  for (const event of events) {
    const modules = usedModules(event._count);
    for (const module of ADOPTION_MODULES) if (modules[module]) adoption[module] += 1;
    if (modules.budget) budgetedEvents += 1;
    const month = monthly.get(monthKey(event.createdAt));
    if (month) { month.events += 1; if (modules.budget) month.budgetedEvents += 1; }
    const workspace = perWorkspace.get(event.workspaceId);
    if (!workspace) continue;
    workspace.events += 1;
    if (modules.budget) workspace.budgetedEvents += 1;
    if ((event.endsAt ?? event.startsAt) >= now) workspace.upcomingEvents += 1;
    if (event.createdAt >= since30d) workspace.eventsLast30d += 1;
  }
  for (const user of newUsers) {
    const month = monthly.get(monthKey(user.createdAt));
    if (month) month.newUsers += 1;
  }

  const workspaceRows = [...perWorkspace.values()].sort((a, b) => b.budgetedEvents - a.budgetedEvents || b.events - a.events || a.name.localeCompare(b.name));
  return {
    generatedAt: now.toISOString(),
    totals: {
      workspaces: workspaces.length,
      activeWorkspaces30d: workspaceActivity.length,
      workspacesWithBudget: workspaceRows.filter((workspace) => workspace.budgetedEvents > 0).length,
      events: events.length,
      budgetedEvents,
      eventsLast30d: events.filter((event) => event.createdAt >= since30d).length,
      activeUsers7d: activeUsers.filter((row) => row._max.createdAt && row._max.createdAt >= since7d).length,
      activeUsers30d: activeUsers.length,
      newUsers30d: newUsers.filter((user) => user.createdAt >= since30d).length,
    },
    adoption: ADOPTION_MODULES.map((module) => ({ module, events: adoption[module] })),
    monthly: [...monthly].map(([month, values]) => ({ month, ...values })),
    workspaces: workspaceRows,
  };
}
