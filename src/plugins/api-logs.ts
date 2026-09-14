import fp from "fastify-plugin";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logAction, sanitizeLog } from "../lib/log-sanitizer.js";

export const apiLogsPlugin = fp(async (app) => {
  const responses = new WeakMap<object, { body: Prisma.InputJsonValue; userId?: string; email?: string }>();
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    const path = request.url.split("?")[0];
    const isAdmin = path.startsWith("/api/admin") && request.method === "GET" && reply.statusCode < 400;
    let parsed: unknown;
    // Never read streams, binary downloads or admin log responses (recursive logging).
    if (!isAdmin && String(reply.getHeader("content-type")).includes("application/json") && typeof payload === "string") {
      try { parsed = JSON.parse(payload); } catch { /* Non JSON payload omitted. */ }
    }
    const authUser = path.startsWith("/api/auth/") && reply.statusCode < 400
      ? (parsed as { user?: { id?: string; email?: string } } | undefined)?.user : undefined;
    responses.set(request, {
      body: isAdmin ? "[réponse administration omise]" : sanitizeLog(parsed),
      userId: authUser?.id, email: authUser?.email,
    });
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    const response = responses.get(request);
    const route = request.routeOptions.url ?? "[route inconnue]";
    try {
      await prisma.apiLog.create({ data: {
        requestId: request.id, method: request.method,
        // Use route patterns so secrets in path parameters are never persisted.
        path: request.routeOptions.url ?? "[route inconnue]", route,
        statusCode: reply.statusCode, durationMs: Math.round(reply.elapsedTime),
        userId: request.user?.id ?? response?.userId,
        userEmail: request.user?.email ?? response?.email ?? (route.startsWith("/api/auth/") && typeof (request.body as { email?: unknown } | undefined)?.email === "string" ? (request.body as { email: string }).email.slice(0, 254) : undefined),
        workspaceId: request.workspaceId || null,
        action: logAction(request.method, route, reply.statusCode),
        query: sanitizeLog({ query: request.query, params: request.params }),
        requestBody: sanitizeLog(request.body), responseBody: response?.body ?? "[réponse sans corps]",
      } });
    } catch {
      app.log.error({ requestId: request.id }, "API journal persistence failed");
    }
  });
  async function prune() {
    try { await prisma.apiLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86400000) } } }); }
    catch { app.log.error("API journal retention failed"); }
  }
  const timer = setInterval(() => { void prune(); }, 3600000);
  timer.unref();
  app.addHook("onReady", prune);
  app.addHook("onClose", async () => clearInterval(timer));
});
