import fp from "fastify-plugin";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "../prisma.js";

type AuthUser = Pick<User, "id" | "email" | "name" | "image" | "role" | "personId">;

declare module "fastify" {
  interface FastifyRequest {
    userRole: UserRole;
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
    url.startsWith("/api/auth/login-link") ||
    url.startsWith("/api/auth/verify")
  );
}

export const authPlugin = fp(async (fastify) => {
  fastify.decorateRequest("userRole", "VIEWER");
  fastify.decorateRequest("user");

  fastify.addHook("preHandler", async (request) => {
    if (isPublicRoute(request.url)) return;

    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;
    const token =
      getBearerToken(authorization) ??
      getCookieValue(request.headers.cookie, "gwertable_session");

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

    const { archivedAt: _archivedAt, ...user } = session.user;
    request.user = user;
    request.userRole = session.user.role;
  });
});
