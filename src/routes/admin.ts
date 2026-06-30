import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { isAdminEmail } from "../lib/admin.js";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";

const userParamsSchema = z.object({ userId: z.string().min(1) });
const updatePlanSchema = z.object({
  usagePlan: z.enum(["BETA_TEST", "PLATINIUM"]),
});

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
      users,
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
      prisma.user.findMany({
        where: { archivedAt: null },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          usagePlan: true,
          emailVerified: true,
          createdAt: true,
          defaultWorkspace: { select: { id: true, name: true } },
          workspaceMemberships: {
            select: { role: true, workspace: { select: { id: true, name: true } } },
            orderBy: { createdAt: "asc" },
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
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        usagePlan: user.usagePlan,
        emailVerified: user.emailVerified?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        defaultWorkspace: user.defaultWorkspace
          ? { id: user.defaultWorkspace.id, name: user.defaultWorkspace.name }
          : null,
        workspaces: user.workspaceMemberships.map((membership) => ({
          id: membership.workspace.id,
          name: membership.workspace.name,
          role: membership.role,
        })),
      })),
    };
  });

  fastify.patch("/api/admin/users/:userId/plan", async (request) => {
    assertAdmin(request);
    const { userId } = userParamsSchema.parse(request.params);
    const { usagePlan } = updatePlanSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundError("Utilisateur introuvable");

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { usagePlan },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        usagePlan: true,
        emailVerified: true,
        createdAt: true,
        defaultWorkspace: { select: { id: true, name: true } },
        workspaceMemberships: {
          select: { role: true, workspace: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        usagePlan: updated.usagePlan,
        emailVerified: updated.emailVerified?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        defaultWorkspace: updated.defaultWorkspace
          ? { id: updated.defaultWorkspace.id, name: updated.defaultWorkspace.name }
          : null,
        workspaces: updated.workspaceMemberships.map((membership) => ({
          id: membership.workspace.id,
          name: membership.workspace.name,
          role: membership.role,
        })),
      },
    };
  });
}
