import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { requireCan } from "../lib/permissions.js";

const inviteSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  role: z.enum(["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"]),
});

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function workspaceRoutes(fastify: FastifyInstance) {
  fastify.get("/api/workspace", async (request) => {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: request.workspaceId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });

    return { workspace };
  });

  fastify.get("/api/workspace/members", async (request) => {
    requireCan(request.userRole, "user.manage");

    const [members, invitations] = await Promise.all([
      prisma.workspaceMember.findMany({
        where: { workspaceId: request.workspaceId },
        include: {
          user: { select: { id: true, email: true, name: true, image: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.workspaceInvitation.findMany({
        where: {
          workspaceId: request.workspaceId,
          acceptedAt: null,
          expires: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      members: members.map((member) => ({
        id: member.id,
        role: member.role,
        createdAt: member.createdAt,
        user: member.user,
      })),
      invitations: invitations.map((invitation) => {
        const inviteUrl = new URL("/login", env.FRONTEND_URL);
        inviteUrl.searchParams.set("invite", invitation.token);

        return {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expires: invitation.expires,
          createdAt: invitation.createdAt,
          inviteUrl: inviteUrl.toString(),
        };
      }),
    };
  });

  fastify.post("/api/workspace/invitations", async (request, reply) => {
    requireCan(request.userRole, "user.manage");
    const parsed = inviteSchema.parse(request.body);

    const existingMember = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId: request.workspaceId,
        user: { email: parsed.email },
      },
      select: { id: true },
    });
    if (existingMember) {
      const error = new Error("Ce compte est deja membre de cet espace");
      error.name = "ConflictError";
      throw error;
    }

    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invitation = await prisma.workspaceInvitation.upsert({
      where: { workspaceId_email: { workspaceId: request.workspaceId, email: parsed.email } },
      create: {
        workspaceId: request.workspaceId,
        email: parsed.email,
        role: parsed.role,
        token: randomToken(),
        expires,
      },
      update: {
        role: parsed.role,
        token: randomToken(),
        expires,
        acceptedAt: null,
      },
    });

    const inviteUrl = new URL("/login", env.FRONTEND_URL);
    inviteUrl.searchParams.set("invite", invitation.token);

    return reply.status(201).send({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expires: invitation.expires,
      inviteUrl: inviteUrl.toString(),
    });
  });
}
