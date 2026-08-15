import fp from "fastify-plugin";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "../prisma.js";
import { UnauthorizedError, ForbiddenError } from "../lib/errors.js";
import { isAdminEmail } from "../lib/admin.js";

/**
 * Authenticated account in a workspace context.
 *
 * `role` is retained for API compatibility, but always represents the role in
 * the current workspace (never the legacy `User.role` database column).
 */
type AuthUser = Pick<User, "id" | "email" | "name" | "image" | "personId"> & {
  usagePlan: User["usagePlan"];
  firstName: User["firstName"];
  lastName: User["lastName"];
  phone: User["phone"];
  addressLine1: User["addressLine1"];
  addressLine2: User["addressLine2"];
  postalCode: User["postalCode"];
  city: User["city"];
  country: User["country"];
  companyName: User["companyName"];
  companyAddressLine1: User["companyAddressLine1"];
  companyAddressLine2: User["companyAddressLine2"];
  companyPostalCode: User["companyPostalCode"];
  companyCity: User["companyCity"];
  companyCountry: User["companyCountry"];
  companySiret: User["companySiret"];
  companyVatNumber: User["companyVatNumber"];
  billingEmail: User["billingEmail"];
  locale: User["locale"];
  currency: User["currency"];
  timezone: User["timezone"];
  emailNotificationsEnabled: User["emailNotificationsEnabled"];
  taskReminderNotificationsEnabled: User["taskReminderNotificationsEnabled"];
  eventReminderNotificationsEnabled: User["eventReminderNotificationsEnabled"];
  marketingNotificationsEnabled: User["marketingNotificationsEnabled"];
  themeMode: User["themeMode"];
  themePreset: User["themePreset"];
  themePrimaryColor: User["themePrimaryColor"];
  role: UserRole;
  workspaceRole: UserRole;
  workspaceId: string;
  workspaceName: string;
};

declare module "fastify" {
  interface FastifyRequest {
    userRole: UserRole;
    workspaceId: string;
    eventScoped: boolean;
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
    url.startsWith("/docs") ||
    url.startsWith("/documentation") ||
    url.startsWith("/uploads/receipts/") ||
    url.startsWith("/uploads/event-banners/") ||
    url.startsWith("/uploads/profile-images/") ||
    url.startsWith("/uploads/equipment-quotes/") ||
    url.startsWith("/uploads/equipment-photos/") ||
    url.startsWith("/uploads/task-attachments/") ||
    url.startsWith("/calendar/tasks/") ||
    url.startsWith("/api/auth/login-options") ||
    url.startsWith("/api/auth/login-link") ||
    url.startsWith("/api/auth/register") ||
    url.startsWith("/api/auth/verify") ||
    url.startsWith("/api/auth/password/login") ||
    url.startsWith("/api/auth/password/setup")
  );
}

function isAdminRoute(url: string): boolean {
  return url.startsWith("/api/admin");
}

export const authPlugin = fp(async (fastify) => {
  fastify.decorateRequest("userRole", "VIEWER");
  fastify.decorateRequest("workspaceId", "");
  fastify.decorateRequest("eventScoped", false);
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
      throw new UnauthorizedError("Non authentifie");
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
            firstName: true,
            lastName: true,
            phone: true,
            addressLine1: true,
            addressLine2: true,
            postalCode: true,
            city: true,
            country: true,
            companyName: true,
            companyAddressLine1: true,
            companyAddressLine2: true,
            companyPostalCode: true,
            companyCity: true,
            companyCountry: true,
            companySiret: true,
            companyVatNumber: true,
            billingEmail: true,
            locale: true,
            currency: true,
            timezone: true,
            emailNotificationsEnabled: true,
            taskReminderNotificationsEnabled: true,
            eventReminderNotificationsEnabled: true,
            marketingNotificationsEnabled: true,
            themeMode: true,
            themePreset: true,
            themePrimaryColor: true,
            usagePlan: true,
            personId: true,
            defaultWorkspaceId: true,
            archivedAt: true,
          },
        },
      },
    });

    if (!session || session.expires <= new Date() || session.user.archivedAt) {
      throw new UnauthorizedError("Non authentifie");
    }

    if (isAdminRoute(request.url) && isAdminEmail(session.user.email)) {
      const { archivedAt: _archivedAt, defaultWorkspaceId, ...user } = session.user;
      request.workspaceId = defaultWorkspaceId ?? "";
      request.eventScoped = false;
      request.user = {
        ...user,
        role: "VIEWER",
        workspaceRole: "VIEWER",
        workspaceId: defaultWorkspaceId ?? "",
        workspaceName: "Administration",
      };
      // Platform administration is deliberately separate from workspace roles.
      // Admin routes authorise through isAdminEmail(), not through User.role.
      request.userRole = "VIEWER";
      return;
    }

    let workspaceId = session.user.defaultWorkspaceId;
    let membership = workspaceId
      ? await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId,
              userId: session.user.id,
            },
          },
          select: {
            role: true,
            workspace: {
              select: { name: true },
            },
          },
        })
      : null;

    let eventScoped = false;

    if (!membership) {
      const collaborator = await prisma.eventCollaborator.findFirst({
        where: {
          acceptedAt: { not: null },
          OR: [{ userId: session.user.id }, { email: session.user.email }],
        },
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          workspaceId: true,
          workspace: { select: { name: true } },
        },
      });

      if (collaborator) {
        workspaceId = collaborator.workspaceId;
        membership = { role: collaborator.role, workspace: collaborator.workspace };
        eventScoped = true;
      }
    }

    if (!workspaceId || !membership) {
      throw new ForbiddenError("Aucun acces associe a ce compte");
    }

    const { archivedAt: _archivedAt, defaultWorkspaceId, ...user } = session.user;
    request.workspaceId = workspaceId;
    request.eventScoped = eventScoped;
    request.user = {
      ...user,
      role: membership.role,
      workspaceRole: membership.role,
      workspaceId,
      workspaceName: membership.workspace.name,
    };
    request.userRole = membership.role;
  });
});
