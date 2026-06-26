import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../prisma.js";
import { isAdminEmail } from "../lib/admin.js";
import { ForbiddenError } from "../lib/errors.js";

function assertAdmin(request: FastifyRequest) {
  if (!request.user || !isAdminEmail(request.user.email)) {
    throw new ForbiddenError("Acces admin reserve");
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/overview", async (request) => {
    assertAdmin(request);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      verifiedUsers,
      usersWithPassword,
      activeSessions,
      totalWorkspaces,
      totalEvents,
      upcomingEvents,
      recentUsers,
      recentWorkspaces,
      recentEvents,
      eventsByStatus,
      expenseTotals,
      incomeTotals,
      ticketTiers,
      workspaces,
      nextEvents,
    ] = await Promise.all([
      prisma.user.count({ where: { archivedAt: null } }),
      prisma.user.count({ where: { archivedAt: null, emailVerified: { not: null } } }),
      prisma.user.count({ where: { archivedAt: null, passwordHash: { not: null } } }),
      prisma.session.count({ where: { expires: { gt: now } } }),
      prisma.workspace.count(),
      prisma.event.count(),
      prisma.event.count({ where: { startsAt: { gte: now } } }),
      prisma.user.count({ where: { archivedAt: null, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.workspace.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.event.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.event.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.expense.aggregate({
        _sum: { amountTtcCents: true, amountCents: true },
      }),
      prisma.income.aggregate({
        _sum: { amountTtcCents: true, amountCents: true },
      }),
      prisma.ticketTier.findMany({
        where: { archivedAt: null },
        select: { organizerRevenueCents: true, quantity: true, sold: true },
      }),
      prisma.workspace.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: {
            select: {
              members: true,
              events: true,
              persons: true,
              equipmentItems: true,
            },
          },
          events: {
            select: {
              startsAt: true,
              status: true,
              expenses: { select: { amountTtcCents: true, amountCents: true } },
              incomes: { select: { amountTtcCents: true, amountCents: true } },
            },
          },
        },
      }),
      prisma.event.findMany({
        where: { startsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        take: 8,
        select: {
          id: true,
          name: true,
          startsAt: true,
          status: true,
          workspace: { select: { name: true } },
          _count: { select: { participants: true, tasks: true } },
          ticketTiers: {
            where: { archivedAt: null },
            select: { sold: true, quantity: true, organizerRevenueCents: true },
          },
        },
      }),
    ]);

    const ticketingRevenueCents = sum(
      ticketTiers.map((tier) => tier.organizerRevenueCents * tier.sold),
    );
    const ticketingCapacity = sum(ticketTiers.map((tier) => tier.quantity));
    const ticketsSold = sum(ticketTiers.map((tier) => tier.sold));

    return {
      generatedAt: now.toISOString(),
      kpis: {
        totalUsers,
        verifiedUsers,
        usersWithPassword,
        activeSessions,
        totalWorkspaces,
        totalEvents,
        upcomingEvents,
        recentUsers,
        recentWorkspaces,
        recentEvents,
        totalExpenseCents: expenseTotals._sum.amountTtcCents ?? expenseTotals._sum.amountCents ?? 0,
        totalIncomeCents: incomeTotals._sum.amountTtcCents ?? incomeTotals._sum.amountCents ?? 0,
        ticketingRevenueCents,
        ticketsSold,
        ticketingCapacity,
      },
      eventsByStatus: eventsByStatus.map((entry) => ({
        status: entry.status,
        count: entry._count._all,
      })),
      workspaces: workspaces.map((workspace) => {
        const totalExpenseCents = sum(
          workspace.events.flatMap((event) =>
            event.expenses.map((expense) => expense.amountTtcCents || expense.amountCents),
          ),
        );
        const totalIncomeCents = sum(
          workspace.events.flatMap((event) =>
            event.incomes.map((income) => income.amountTtcCents || income.amountCents),
          ),
        );
        const lastEventAt = workspace.events
          .map((event) => event.startsAt)
          .sort((a, b) => b.getTime() - a.getTime())[0];

        return {
          id: workspace.id,
          name: workspace.name,
          createdAt: workspace.createdAt.toISOString(),
          membersCount: workspace._count.members,
          eventsCount: workspace._count.events,
          contactsCount: workspace._count.persons,
          equipmentCount: workspace._count.equipmentItems,
          upcomingEventsCount: workspace.events.filter((event) => event.startsAt >= now).length,
          doneEventsCount: workspace.events.filter((event) => event.status === "DONE").length,
          totalExpenseCents,
          totalIncomeCents,
          lastEventAt: lastEventAt?.toISOString() ?? null,
        };
      }),
      nextEvents: nextEvents.map((event) => {
        const sold = sum(event.ticketTiers.map((tier) => tier.sold));
        const capacity = sum(event.ticketTiers.map((tier) => tier.quantity));
        const revenueCents = sum(
          event.ticketTiers.map((tier) => tier.organizerRevenueCents * tier.sold),
        );

        return {
          id: event.id,
          name: event.name,
          workspaceName: event.workspace.name,
          startsAt: event.startsAt.toISOString(),
          status: event.status,
          participantsCount: event._count.participants,
          tasksCount: event._count.tasks,
          ticketsSold: sold,
          ticketingCapacity: capacity,
          ticketingRevenueCents: revenueCents,
        };
      }),
    };
  });
}
