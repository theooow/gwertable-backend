import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { sendMagicLinkEmail } from "../lib/mailer.js";
import { prisma } from "../prisma.js";

const loginLinkSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  inviteToken: z.string().optional(),
});

const verifySchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  token: z.string().min(1),
  inviteToken: z.string().optional(),
});

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

async function getValidInvitation(email: string, inviteToken: string | undefined) {
  if (!inviteToken) return null;

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token: inviteToken },
  });
  if (
    !invitation ||
    invitation.email !== email ||
    invitation.acceptedAt ||
    invitation.expires <= new Date()
  ) {
    const error = new Error("Invitation invalide ou expiree");
    error.name = "UnauthorizedError";
    throw error;
  }

  return invitation;
}

async function findOrCreateUser(email: string, inviteToken?: string) {
  const invitation = await getValidInvitation(email, inviteToken);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && invitation) {
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
      workspaceMemberships: {
        create: {
          workspaceId: invitation?.workspaceId ?? workspace!.id,
          role: invitation?.role ?? "ADMIN",
        },
      },
    },
  });
}

async function getWorkspaceRole(userId: string, workspaceId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    select: { role: true },
  });
  return membership?.role ?? "VIEWER";
}

async function acceptInvitation(email: string, inviteToken: string | undefined, userId: string) {
  const invitation = await getValidInvitation(email, inviteToken);
  if (!invitation) return;

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

    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token },
    });

    if (
      !verificationToken ||
      verificationToken.identifier !== email ||
      verificationToken.expires <= new Date()
    ) {
      const error = new Error("Lien de connexion invalide ou expire");
      error.name = "UnauthorizedError";
      throw error;
    }

    await prisma.verificationToken.delete({
      where: { token },
    });

    const user = await findOrCreateUser(email, inviteToken);
    await acceptInvitation(email, inviteToken, user.id);
    const workspaceId = user.defaultWorkspaceId;
    const role = workspaceId ? await getWorkspaceRole(user.id, workspaceId) : user.role;
    const workspace = workspaceId
      ? await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } })
      : null;
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
