import fp from "fastify-plugin";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "../prisma.js";

type AuthUser = Pick<User, "id" | "email" | "name" | "image" | "role" | "personId"> & {
  workspaceId: string;
  workspaceName: string;
};

declare module "fastify" {
  interface FastifyRequest {
    userRole: UserRole;
    workspaceId: string;
    user?: AuthUser;
  }
}

function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }

  return null;
}

function getBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function isPublicRoute(url: string): boolean {
  return (
    url === "/health" ||
    url.startsWith("/uploads/receipts/") ||
    url.startsWith("/calendar/tasks/") ||
    url.startsWith("/api/auth/login-link") ||
    url.startsWith("/api/auth/verify")
  );
}

export const authPlugin = fp(async (fastify) => {
  fastify.decorateRequest("userRole", "VIEWER");
  fastify.decorateRequest("workspaceId", "");
  fastify.decorateRequest("user");

  fastify.addHook("preHandler", async (request) => {
    if (isPublicRoute(request.url)) return;

    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;
    const token =
      getBearerToken(authorization) ??
      getCookieValue(request.headers.cookie, "abregi_session");

    if (!token) {
      const error = new Error("Non authentifie");
      error.name = "UnauthorizedError";
      throw error;
    }

    const session = await prisma.session.findUnique({
      where: { sessionToken: token },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            personId: true,
            defaultWorkspaceId: true,
            archivedAt: true,
          },
        },
      },
    });

    if (!session || session.expires <= new Date() || session.user.archivedAt) {
      const error = new Error("Non authentifie");
      error.name = "UnauthorizedError";
      throw error;
    }

    if (!session.user.defaultWorkspaceId) {
      const error = new Error("Aucun espace de travail associe a ce compte");
      error.name = "ForbiddenError";
      throw error;
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: session.user.defaultWorkspaceId,
          userId: session.user.id,
        },
      },
      select: {
        role: true,
        workspace: {
          select: { name: true },
        },
      },
    });
    if (!membership) {
      const error = new Error("Compte non membre de cet espace de travail");
      error.name = "ForbiddenError";
      throw error;
    }

    const { archivedAt: _archivedAt, defaultWorkspaceId, ...user } = session.user;
    request.workspaceId = defaultWorkspaceId;
    request.user = {
      ...user,
      role: membership.role,
      workspaceId: defaultWorkspaceId,
      workspaceName: membership.workspace.name,
    };
    request.userRole = membership.role;
  });
});
