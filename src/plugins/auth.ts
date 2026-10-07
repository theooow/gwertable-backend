import fp from "fastify-plugin";
import type { ApiTokenScope, Prisma, User, UserRole } from "@prisma/client";
import { prisma } from "../prisma.js";
import { UnauthorizedError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import { isAdminEmail } from "../lib/admin.js";
import { CURRENT_TERMS_VERSION } from "../lib/terms.js";
import { hashApiToken, isApiToken, isApiTokenForbiddenRoute } from "../lib/api-token.js";

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
  termsAccepted: boolean;
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
    /** Set when the request is authenticated with a personal API token instead of a session. */
    apiTokenScope?: ApiTokenScope;
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

export function isPublicRoute(url: string): boolean {
  return (
    url === "/health" ||
    url.startsWith("/api/public/volunteers/") ||
    url.startsWith("/api/public/tracking/") ||
    url.startsWith("/api/public/budget-trial") ||
    url.startsWith("/docs") ||
    url.startsWith("/documentation") ||
    url.startsWith("/uploads/receipts/") ||
    url.startsWith("/uploads/event-banners/") ||
    url.startsWith("/uploads/association-logos/") ||
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

const authUserSelect = {
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
  termsVersion: true,
  usagePlan: true,
  personId: true,
  defaultWorkspaceId: true,
  archivedAt: true,
} satisfies Prisma.UserSelect;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MCP_PATH = "/mcp";
const API_TOKEN_TOUCH_INTERVAL_MS = 60_000;

async function findAccount(token: string) {
  if (!isApiToken(token)) {
    const session = await prisma.session.findUnique({
      where: { sessionToken: token },
      include: { user: { select: authUserSelect } },
    });
    return session && session.expires > new Date() ? { user: session.user, apiTokenScope: undefined } : null;
  }

  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    include: { user: { select: authUserSelect } },
  });
  if (!apiToken || (apiToken.expiresAt && apiToken.expiresAt <= new Date())) return null;
  if (!apiToken.lastUsedAt || apiToken.lastUsedAt.getTime() < Date.now() - API_TOKEN_TOUCH_INTERVAL_MS) {
    await prisma.apiToken.update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } });
  }
  return { user: apiToken.user, apiTokenScope: apiToken.scope };
}

export const authPlugin = fp(async (fastify) => {
  fastify.decorateRequest("userRole", "VIEWER");
  fastify.decorateRequest("workspaceId", "");
  fastify.decorateRequest("eventScoped", false);
  fastify.decorateRequest("user");
  fastify.decorateRequest("apiTokenScope");

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

    const authenticated = await findAccount(token);
    if (!authenticated || authenticated.user.archivedAt) {
      throw new UnauthorizedError("Non authentifie");
    }

    const { apiTokenScope } = authenticated;
    if (apiTokenScope) {
      if (isApiTokenForbiddenRoute(request.method, request.url)) {
        throw new ForbiddenError("Action impossible avec un token d'API");
      }
      if (apiTokenScope === "READ" && !READ_METHODS.has(request.method) && request.url.split("?")[0] !== MCP_PATH) {
        throw new ForbiddenError("Token d'API en lecture seule");
      }
      request.apiTokenScope = apiTokenScope;
    }

    if (isAdminRoute(request.url) && isAdminEmail(authenticated.user.email)) {
      const { archivedAt: _archivedAt, defaultWorkspaceId, termsVersion, ...user } = authenticated.user;
      request.workspaceId = defaultWorkspaceId ?? "";
      request.eventScoped = false;
      request.user = {
        ...user,
        termsAccepted: termsVersion === CURRENT_TERMS_VERSION,
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

    let workspaceId = authenticated.user.defaultWorkspaceId;
    let membership = workspaceId
      ? await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId,
              userId: authenticated.user.id,
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
          ...(workspaceId ? { workspaceId } : {}),
          acceptedAt: { not: null },
          OR: [{ userId: authenticated.user.id }, { email: authenticated.user.email }],
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

    const { archivedAt: _archivedAt, defaultWorkspaceId, termsVersion, ...user } = authenticated.user;
    request.workspaceId = workspaceId;
    request.eventScoped = eventScoped;
    request.user = {
      ...user,
      termsAccepted: termsVersion === CURRENT_TERMS_VERSION,
      role: membership.role,
      workspaceRole: membership.role,
      workspaceId,
      workspaceName: membership.workspace.name,
    };
    request.userRole = membership.role;

    // Resolve the invitation for the requested event, never reuse another event's role.
    if (eventScoped) {
      const params = request.params as { eventId?: string; id?: string };
      const route = request.routeOptions.url ?? "";
      let eventId = params.eventId ?? (route === "/api/events/:id" ? params.id : undefined);
      if (route.startsWith("/api/run-of-show/") && params.id) {
        const where = { id: params.id, event: { workspaceId } };
        const item = route.includes("/tracks/")
          ? await prisma.runOfShowTrack.findFirst({ where, select: { eventId: true } })
          : route.includes("/sections/")
            ? await prisma.runOfShowSection.findFirst({ where, select: { eventId: true } })
            : await prisma.runOfShowItem.findFirst({ where, select: { eventId: true } });
        if (!item) throw new NotFoundError("Élément introuvable");
        eventId = item.eventId;
      }
      if (eventId) {
        const invitation = await prisma.eventCollaborator.findFirst({
          where: { eventId, workspaceId, acceptedAt: { not: null }, OR: [{ userId: user.id }, { email: user.email }] },
          select: { role: true },
        });
        if (!invitation) throw new ForbiddenError("Accès refusé à cet événement");
        request.userRole = invitation.role;
      }
    }
  });
});
