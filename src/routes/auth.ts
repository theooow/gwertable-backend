import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { sendMagicLinkEmail } from "../lib/mailer.js";
import { prisma } from "../prisma.js";
import type { UserRole } from "@prisma/client";

const loginLinkSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  inviteToken: z.string().optional(),
});

const verifySchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  token: z.string().min(1),
  inviteToken: z.string().optional(),
});

type WorkspaceInvitationRecord = {
  kind: "workspace";
  id: string;
  workspaceId: string;
  email: string;
  role: UserRole;
  acceptedAt: Date | null;
  expires: Date;
};

type EventInvitationRecord = {
  kind: "event";
  id: string;
  eventId: string;
  workspaceId: string;
  email: string;
  role: UserRole;
  acceptedAt: Date | null;
  expires: Date;
};

type InvitationRecord = WorkspaceInvitationRecord | EventInvitationRecord;

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

async function getValidInvitation(email: string, inviteToken: string | undefined): Promise<InvitationRecord | null> {
  if (!inviteToken) return null;

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token: inviteToken },
  });
  if (invitation) {
    if (invitation.email !== email || invitation.acceptedAt || invitation.expires <= new Date()) {
      const error = new Error("Invitation invalide ou expiree");
      error.name = "UnauthorizedError";
      throw error;
    }

    return {
      kind: "workspace",
      id: invitation.id,
      workspaceId: invitation.workspaceId,
      email: invitation.email,
      role: invitation.role,
      acceptedAt: invitation.acceptedAt,
      expires: invitation.expires,
    };
  }

  const collaborator = await prisma.eventCollaborator.findUnique({
    where: { token: inviteToken },
    include: { event: { select: { workspaceId: true } } },
  });
  if (
    !collaborator ||
    collaborator.email !== email ||
    collaborator.acceptedAt ||
    collaborator.expires <= new Date()
  ) {
    const error = new Error("Invitation invalide ou expiree");
    error.name = "UnauthorizedError";
    throw error;
  }

  return {
    kind: "event",
    id: collaborator.id,
    eventId: collaborator.eventId,
    workspaceId: collaborator.event.workspaceId,
    email: collaborator.email,
    role: collaborator.role,
    acceptedAt: collaborator.acceptedAt,
    expires: collaborator.expires,
  };
}

async function getAccessibleWorkspaceMembership(userId: string, workspaceId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    select: {
      role: true,
      workspace: { select: { name: true } },
    },
  });
  if (membership) {
    return {
      kind: "workspace" as const,
      role: membership.role,
      workspaceName: membership.workspace.name,
    };
  }

  const collaborator = await prisma.eventCollaborator.findFirst({
    where: {
      workspaceId,
      acceptedAt: { not: null },
      userId,
    },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      workspace: { select: { name: true } },
    },
  });

  if (!collaborator) return null;

  return {
    kind: "event" as const,
    role: collaborator.role,
    workspaceName: collaborator.workspace.name,
  };
}

async function findOrCreateUser(email: string, inviteToken?: string) {
  const invitation = await getValidInvitation(email, inviteToken);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && invitation?.kind === "workspace") {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        defaultWorkspaceId: invitation.workspaceId,
        workspaceMemberships: {
          upsert: {
            where: {
              workspaceId_userId: {
                workspaceId: invitation.workspaceId,
                userId: existing.id,
              },
            },
            create: {
              workspaceId: invitation.workspaceId,
              role: invitation.role,
            },
            update: {
              role: invitation.role,
            },
          },
        },
      },
    });
  }

  if (existing && invitation?.kind === "event") {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        defaultWorkspaceId: invitation.workspaceId,
      },
    });
  }

  if (existing?.defaultWorkspaceId) return existing;

  if (existing) {
    const workspace = await prisma.workspace.create({
      data: { name: existing.name ?? existing.email },
    });
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        defaultWorkspaceId: workspace.id,
        workspaceMemberships: {
          create: {
            workspaceId: workspace.id,
            role: existing.role,
          },
        },
      },
    });
  }

  const workspace = invitation
    ? null
    : await prisma.workspace.create({
        data: { name: email },
      });
  return prisma.user.create({
    data: {
      email,
      role: invitation?.role ?? "ADMIN",
      defaultWorkspaceId: invitation?.workspaceId ?? workspace?.id,
      ...(invitation?.kind === "workspace"
        ? {
            workspaceMemberships: {
              create: {
                workspaceId: invitation.workspaceId,
                role: invitation.role,
              },
            },
          }
        : {
            workspaceMemberships: workspace
              ? {
                  create: {
                    workspaceId: workspace.id,
                    role: "ADMIN",
                  },
                }
              : undefined,
          }),
    },
  });
}

async function getWorkspaceRole(userId: string, workspaceId: string) {
  const access = await getAccessibleWorkspaceMembership(userId, workspaceId);
  return access?.role ?? "VIEWER";
}

async function acceptInvitation(email: string, inviteToken: string | undefined, userId: string) {
  const invitation = await getValidInvitation(email, inviteToken);
  if (!invitation) return;

  if (invitation.kind === "workspace") {
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: invitation.workspaceId,
          userId,
        },
      },
      create: {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
      },
      update: {
        role: invitation.role,
      },
    });
    return;
  }

  await prisma.eventCollaborator.update({
    where: { id: invitation.id },
    data: {
      acceptedAt: new Date(),
      userId,
    },
  });
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/auth/login-link", async (request) => {
    const { email, inviteToken } = loginLinkSchema.parse(request.body);
    await getValidInvitation(email, inviteToken);
    const token = randomToken();
    const expires = new Date(Date.now() + env.AUTH_TOKEN_TTL_MINUTES * 60 * 1000);

    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
      },
    });

    const url = new URL("/login/verify", env.FRONTEND_URL);
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);
    if (inviteToken) url.searchParams.set("invite", inviteToken);

    await sendMagicLinkEmail({ email, url: url.toString() });
    fastify.log.info({ email }, "Magic login link sent");

    return {
      ok: true,
      email,
    };
  });

  fastify.post("/api/auth/verify", async (request, reply) => {
    const { email, token, inviteToken } = verifySchema.parse(request.body);
    const now = new Date();
    const latestAllowedExpires = new Date(now.getTime() + env.AUTH_TOKEN_TTL_MINUTES * 60 * 1000);

    await prisma.verificationToken.deleteMany({
      where: { expires: { lte: now } },
    });

    const verificationToken = await prisma.verificationToken.deleteMany({
      where: {
        identifier: email,
        token,
        expires: { gt: now, lte: latestAllowedExpires },
      },
    });

    if (verificationToken.count !== 1) {
      const error = new Error("Lien de connexion invalide ou expire");
      error.name = "UnauthorizedError";
      throw error;
    }

    const user = await findOrCreateUser(email, inviteToken);
    await acceptInvitation(email, inviteToken, user.id);
    let workspaceId = user.defaultWorkspaceId;
    let role = workspaceId ? await getWorkspaceRole(user.id, workspaceId) : user.role;
    let workspace = workspaceId
      ? await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } })
      : null;

    if (!workspaceId) {
      const access = await prisma.eventCollaborator.findFirst({
        where: { acceptedAt: { not: null }, userId: user.id },
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          workspaceId: true,
          workspace: { select: { name: true } },
        },
      });
      if (access) {
        workspaceId = access.workspaceId;
        role = access.role;
        workspace = access.workspace;
      }
    }
    const sessionToken = randomToken();
    const expires = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires,
      },
    });

    return reply.send({
      sessionToken,
      expires: expires.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role,
        personId: user.personId,
        workspaceId,
        workspaceName: workspace?.name ?? "",
      },
    });
  });

  fastify.get("/api/auth/me", async (request) => ({
    user: request.user,
  }));

  fastify.post("/api/auth/logout", async (request) => {
    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;

    if (token) {
      await prisma.session.deleteMany({ where: { sessionToken: token } });
    }

    return { ok: true };
  });
}
