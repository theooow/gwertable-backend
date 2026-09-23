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

const logFilters = z.object({
  q: z.string().max(200).default(""),
  userId: z.string().max(100).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]).optional(),
  status: z.enum(["errors", "server", "success"]).optional(),
  activity: z.enum(["true"]).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", async (request, reply) => {
    assertAdmin(request);
    reply.header("Cache-Control", "no-store");
  });

  fastify.get("/api/admin/logs", { config: { documentation: { querystring: logFilters } } }, async (request) => {
    const filters = logFilters.parse(request.query);
    const where = {
      createdAt: { gte: filters.from ? new Date(filters.from) : new Date(Date.now() - 30 * 86400000), ...(filters.to ? { lte: new Date(filters.to) } : {}) },
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.activity ? { action: { not: null } } : {}),
      ...(filters.status === "errors" ? { statusCode: { gte: 400 } } : filters.status === "server" ? { statusCode: { gte: 500 } } : filters.status === "success" ? { statusCode: { lt: 400 } } : {}),
      ...(filters.q ? { OR: ["route", "userEmail", "requestId", "action", "workspaceId"].map((field) => ({ [field]: { contains: filters.q, mode: "insensitive" as const } })) } : {}),
    };
    const rows = await prisma.apiLog.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      select: { id: true, createdAt: true, requestId: true, method: true, path: true, route: true, statusCode: true, durationMs: true, userId: true, userEmail: true, workspaceId: true, action: true },
    });
    const hasMore = rows.length > filters.limit;
    const logs = rows.slice(0, filters.limit);
    return { logs, nextCursor: hasMore ? logs.at(-1)?.id : null, retentionDays: 30 };
  });

  fastify.get("/api/admin/logs/:id", { config: { documentation: { params: z.object({ id: z.string().max(100) }) } } }, async (request) => {
    const { id } = z.object({ id: z.string().max(100) }).parse(request.params);
    const log = await prisma.apiLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundError("Log introuvable");
    return log;
  });

  fastify.get("/api/admin/overview", { config: { documentation: {  } } }, async () => {
    const since = new Date(Date.now() - 86400000);
    const where = { createdAt: { gte: since }, NOT: { route: { startsWith: "/api/admin" } } };
    const [totalUsers, totalWorkspaces, totalEvents, activeSessions, requests, errors, serverErrors, latency, slowRequests, users] = await Promise.all([
      prisma.user.count({ where: { archivedAt: null } }), prisma.workspace.count(), prisma.event.count(),
      prisma.session.count({ where: { expires: { gt: new Date() } } }),
      prisma.apiLog.count({ where }),
      prisma.apiLog.count({ where: { ...where, statusCode: { gte: 400 } } }),
      prisma.apiLog.count({ where: { ...where, statusCode: { gte: 500 } } }),
      prisma.apiLog.aggregate({ where, _avg: { durationMs: true } }),
      prisma.apiLog.count({ where: { ...where, durationMs: { gte: 1000 } } }),
      prisma.user.findMany({ where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, email: true, name: true, usagePlan: true, emailVerified: true, createdAt: true,
          defaultWorkspace: { select: { id: true, name: true } } } }),
    ]);
    return { generatedAt: new Date().toISOString(), kpis: { totalUsers, totalWorkspaces, totalEvents, activeSessions,
      requests, errors, serverErrors, averageDurationMs: Math.round(latency._avg.durationMs ?? 0), slowRequests }, users };
  });

  fastify.patch("/api/admin/users/:userId/plan", { config: { documentation: { params: userParamsSchema, body: updatePlanSchema } } }, async (request) => {
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
