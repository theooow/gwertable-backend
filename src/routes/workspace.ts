import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { UserRole } from "@prisma/client";
import { z } from "zod";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { requireCan } from "../lib/permissions.js";

const inviteSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  role: z.enum(["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"]),
});
const workspaceMemberParamsSchema = z.object({
  memberId: z.string().min(1),
});
const updateWorkspaceMemberSchema = z.object({
  role: z.enum(["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"]),
});
const updateAccountSchema = z.object({
  name: z.string().trim().max(120).optional().or(z.literal("")),
  image: z.string().trim().max(2000).optional().or(z.literal("")),
});
const profileImageUploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  data: z.string().min(1),
});
const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Le nom de l'espace est requis").max(120),
});
const switchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
});
const contactTransferSchema = z.object({
  sourceWorkspaceId: z.string().min(1),
  excludedPersonIds: z.array(z.string().min(1)).default([]),
});
const deleteConfirmationSchema = z.object({
  confirm: z.string(),
});
const acceptInvitationSchema = z.object({
  inviteToken: z.string().min(1),
});
const allowedProfileImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

function extensionForContentType(contentType: string) {
  switch (contentType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return "";
  }
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

async function getWorkspaceMemberOrThrow(memberId: string, workspaceId: string) {
  const member = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
    select: { id: true, userId: true, role: true },
  });
  if (!member) {
    const error = new Error("Membre introuvable");
    error.name = "NotFoundError";
    throw error;
  }
  return member;
}

async function hasWorkspaceAccess(userId: string, email: string, workspaceId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    select: { id: true },
  });
  if (membership) return true;

  const collaborator = await prisma.eventCollaborator.findFirst({
    where: {
      workspaceId,
      acceptedAt: { not: null },
      OR: [{ userId }, { email }],
    },
    select: { id: true },
  });

  return Boolean(collaborator);
}

async function getAccessibleWorkspaces(userId: string, email: string) {
  const [memberships, collaborators] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        workspace: {
          select: {
            id: true,
            name: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.eventCollaborator.findMany({
      where: {
        acceptedAt: { not: null },
        OR: [{ userId }, { email }],
      },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        workspace: {
          select: {
            id: true,
            name: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
  ]);

  const map = new Map<string, { id: string; name: string; role: UserRole; createdAt: Date; updatedAt: Date }>();
  for (const membership of memberships) {
    map.set(membership.workspace.id, {
      ...membership.workspace,
      role: membership.role,
    });
  }
  for (const collaborator of collaborators) {
    if (!map.has(collaborator.workspace.id)) {
      map.set(collaborator.workspace.id, {
        ...collaborator.workspace,
        role: collaborator.role,
      });
    }
  }

  return [...map.values()];
}

async function copyWorkspaceContacts(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  excludedPersonIds: string[],
) {
  const sourcePeople = await prisma.person.findMany({
    where: {
      workspaceId: sourceWorkspaceId,
      archivedAt: null,
      ...(excludedPersonIds.length ? { id: { notIn: excludedPersonIds } } : {}),
    },
    orderBy: { fullName: "asc" },
  });

  const stats = { created: 0, updated: 0 };

  for (const person of sourcePeople) {
    const uniqueWhere = person.email
      ? { workspaceId_email: { workspaceId: targetWorkspaceId, email: person.email } }
      : person.discordUserId
        ? { workspaceId_discordUserId: { workspaceId: targetWorkspaceId, discordUserId: person.discordUserId } }
        : null;

    if (uniqueWhere) {
      const existing = await prisma.person.findUnique({ where: uniqueWhere });
      if (existing) {
        await prisma.person.update({
          where: { id: existing.id },
          data: {
            fullName: person.fullName,
            email: person.email,
            phone: person.phone,
            discordUserId: person.discordUserId,
            notes: person.notes,
            tags: person.tags,
            archivedAt: person.archivedAt,
          },
        });
        stats.updated += 1;
        continue;
      }
    }

    await prisma.person.create({
      data: {
        workspaceId: targetWorkspaceId,
        fullName: person.fullName,
        email: person.email,
        phone: person.phone,
        discordUserId: person.discordUserId,
        notes: person.notes,
        tags: person.tags,
        archivedAt: person.archivedAt,
      },
    });
    stats.created += 1;
  }

  return stats;
}

async function assertNotLastAdmin(memberId: string, workspaceId: string) {
  const [member, adminCount] = await Promise.all([
    getWorkspaceMemberOrThrow(memberId, workspaceId),
    prisma.workspaceMember.count({ where: { workspaceId, role: "ADMIN" } }),
  ]);

  if (member.role === "ADMIN" && adminCount <= 1) {
    const error = new Error("Impossible de retirer le dernier admin du workspace");
    error.name = "ValidationError";
    throw error;
  }

  return member;
}

export async function workspaceRoutes(fastify: FastifyInstance) {
  fastify.get("/uploads/profile-images/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);
    if (fileName.includes("/") || fileName.includes("\\")) {
      const error = new Error("Image de profil introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    const filePath = path.join(uploadRoot, "profile-images", fileName);
    const data = await readFile(filePath).catch(() => null);
    if (!data) {
      const error = new Error("Image de profil introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    const extension = path.extname(fileName);
    const contentType =
      extension === ".jpg"
        ? "image/jpeg"
        : extension === ".png"
          ? "image/png"
          : extension === ".webp"
            ? "image/webp"
            : extension === ".gif"
              ? "image/gif"
              : "application/octet-stream";
    return reply.type(contentType).send(data);
  });

  fastify.post("/api/uploads/profile-images", async (request, reply) => {
    const parsed = profileImageUploadSchema.parse(request.body);

    if (!allowedProfileImageTypes.has(parsed.contentType)) {
      const error = new Error("Format d'image de profil non supporte");
      error.name = "ValidationError";
      throw error;
    }

    const buffer = Buffer.from(parsed.data, "base64");
    if (buffer.byteLength > 2 * 1024 * 1024) {
      const error = new Error("L'image de profil ne doit pas depasser 2 Mo");
      error.name = "ValidationError";
      throw error;
    }

    const fileName = `${request.user!.id}-${randomUUID()}${extensionForContentType(parsed.contentType)}`;
    const directory = path.join(uploadRoot, "profile-images");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), buffer);

    return reply.status(201).send({
      url: `/uploads/profile-images/${fileName}`,
      fileName: parsed.fileName,
      contentType: parsed.contentType,
      size: buffer.byteLength,
    });
  });

  fastify.get("/api/account", async (request) => ({
    user: request.user,
  }));

  fastify.put("/api/account", async (request) => {
    const parsed = updateAccountSchema.parse(request.body);

    const user = await prisma.user.update({
      where: { id: request.user!.id },
      data: { name: parsed.name || null, image: parsed.image || null },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        personId: true,
      },
    });

    return {
      user: {
        ...user,
        role: request.userRole,
        workspaceId: request.workspaceId,
        workspaceName: request.user!.workspaceName,
      },
    };
  });

  fastify.delete("/api/account", async (request) => {
    const parsed = deleteConfirmationSchema.parse(request.body);
    if (parsed.confirm !== request.user!.email) {
      const error = new Error("La confirmation doit correspondre a l'email du compte");
      error.name = "ValidationError";
      throw error;
    }

    const [memberCount, adminCount] = await Promise.all([
      prisma.workspaceMember.count({ where: { workspaceId: request.workspaceId } }),
      prisma.workspaceMember.count({ where: { workspaceId: request.workspaceId, role: "ADMIN" } }),
    ]);

    if (memberCount > 1 && request.userRole === "ADMIN" && adminCount <= 1) {
      const error = new Error("Invite un autre admin avant de supprimer ce compte");
      error.name = "ValidationError";
      throw error;
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: request.user!.id } });
      const remainingMembers = await tx.workspaceMember.count({
        where: { workspaceId: request.workspaceId },
      });
      if (remainingMembers === 0) {
        await tx.user.updateMany({
          where: { defaultWorkspaceId: request.workspaceId },
          data: { defaultWorkspaceId: null },
        });
        await tx.workspace.delete({ where: { id: request.workspaceId } });
      }
    });

    return { ok: true };
  });

  fastify.get("/api/workspace", async (request) => {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: request.workspaceId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });

    return { workspace };
  });

  fastify.get("/api/workspaces", async (request) => {
    const memberships = await getAccessibleWorkspaces(request.user!.id, request.user!.email);

    return {
      workspaces: memberships.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        role: workspace.role,
        current: workspace.id === request.workspaceId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      })),
    };
  });

  fastify.post("/api/workspace/contacts/transfer", async (request) => {
    requireCan(request.userRole, "person.write");
    const parsed = contactTransferSchema.parse(request.body);

    const sourceAccess = await hasWorkspaceAccess(request.user!.id, request.user!.email, parsed.sourceWorkspaceId);
    if (!sourceAccess) {
      const error = new Error("Source introuvable");
      error.name = "NotFoundError";
      throw error;
    }

    const stats = await prisma.$transaction(async () =>
      copyWorkspaceContacts(parsed.sourceWorkspaceId, request.workspaceId, parsed.excludedPersonIds),
    );

    return {
      ok: true,
      ...stats,
    };
  });

  fastify.post("/api/workspaces", async (request, reply) => {
    const parsed = updateWorkspaceSchema.parse(request.body);

    const workspace = await prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name: parsed.name,
          members: {
            create: {
              userId: request.user!.id,
              role: "ADMIN",
            },
          },
        },
        select: { id: true, name: true, createdAt: true, updatedAt: true },
      });

      await tx.user.update({
        where: { id: request.user!.id },
        data: { defaultWorkspaceId: created.id },
      });

      return created;
    });

    return reply.status(201).send({ workspace });
  });

  fastify.put("/api/account/workspace", async (request) => {
    const parsed = switchWorkspaceSchema.parse(request.body);

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: parsed.workspaceId,
          userId: request.user!.id,
        },
      },
      select: {
        role: true,
        workspace: {
          select: { id: true, name: true },
        },
      },
    });
    if (!membership) {
      const error = new Error("Espace de travail introuvable pour ce compte");
      error.name = "NotFoundError";
      throw error;
    }

    const user = await prisma.user.update({
      where: { id: request.user!.id },
      data: { defaultWorkspaceId: parsed.workspaceId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        personId: true,
      },
    });

    return {
      user: {
        ...user,
        role: membership.role,
        workspaceId: membership.workspace.id,
        workspaceName: membership.workspace.name,
      },
    };
  });

  fastify.put("/api/workspace", async (request) => {
    requireCan(request.userRole, "user.manage");
    const parsed = updateWorkspaceSchema.parse(request.body);

    const workspace = await prisma.workspace.update({
      where: { id: request.workspaceId },
      data: { name: parsed.name },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });

    return { workspace };
  });

  fastify.delete("/api/workspace", async (request) => {
    requireCan(request.userRole, "user.manage");
    const parsed = deleteConfirmationSchema.parse(request.body);
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: request.workspaceId },
      select: { name: true },
    });

    if (parsed.confirm !== workspace.name) {
      const error = new Error("La confirmation doit correspondre au nom de l'espace");
      error.name = "ValidationError";
      throw error;
    }

    const nextMembership = await prisma.workspaceMember.findFirst({
      where: {
        userId: request.user!.id,
        workspaceId: { not: request.workspaceId },
      },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });

    const deletedWorkspace = await prisma.$transaction(async (tx) => {
      if (!nextMembership) {
        await tx.event.deleteMany({ where: { workspaceId: request.workspaceId } });
        await tx.equipmentItem.deleteMany({ where: { workspaceId: request.workspaceId } });
        await tx.workspaceInvitation.deleteMany({ where: { workspaceId: request.workspaceId } });
        await tx.supplier.deleteMany({ where: { workspaceId: request.workspaceId } });
        await tx.venue.deleteMany({ where: { workspaceId: request.workspaceId } });
        await tx.user.updateMany({
          where: { person: { workspaceId: request.workspaceId } },
          data: { personId: null },
        });
        await tx.person.deleteMany({ where: { workspaceId: request.workspaceId } });
        return false;
      }

      const defaultUsers = await tx.user.findMany({
        where: { defaultWorkspaceId: request.workspaceId },
        select: { id: true },
      });

      for (const user of defaultUsers) {
        const fallbackMembership = await tx.workspaceMember.findFirst({
          where: {
            userId: user.id,
            workspaceId: { not: request.workspaceId },
          },
          orderBy: { createdAt: "asc" },
          select: { workspaceId: true },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { defaultWorkspaceId: fallbackMembership?.workspaceId ?? null },
        });
      }

      await tx.workspace.delete({ where: { id: request.workspaceId } });
      return true;
    });

    return { ok: true, deletedWorkspace };
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

  fastify.put("/api/workspace/members/:memberId", async (request) => {
    requireCan(request.userRole, "user.manage");
    const { memberId } = workspaceMemberParamsSchema.parse(request.params);
    const parsed = updateWorkspaceMemberSchema.parse(request.body);
    const member = await assertNotLastAdmin(memberId, request.workspaceId);

    return prisma.workspaceMember.update({
      where: { id: member.id },
      data: { role: parsed.role },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true, image: true, role: true } },
      },
    });
  });

  fastify.delete("/api/workspace/members/:memberId", async (request) => {
    requireCan(request.userRole, "user.manage");
    const { memberId } = workspaceMemberParamsSchema.parse(request.params);
    const member = await assertNotLastAdmin(memberId, request.workspaceId);

    if (member.userId === request.user!.id) {
      const error = new Error("Utilise la suppression du compte pour retirer ton propre acces");
      error.name = "ValidationError";
      throw error;
    }

    await prisma.workspaceMember.delete({ where: { id: member.id } });
    const user = await prisma.user.findUnique({
      where: { id: member.userId },
      select: { defaultWorkspaceId: true },
    });
    if (user?.defaultWorkspaceId === request.workspaceId) {
      const fallbackMembership = await prisma.workspaceMember.findFirst({
        where: { userId: member.userId },
        orderBy: { createdAt: "asc" },
        select: { workspaceId: true },
      });
      await prisma.user.update({
        where: { id: member.userId },
        data: { defaultWorkspaceId: fallbackMembership?.workspaceId ?? null },
      });
    }

    return { ok: true };
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

  fastify.post("/api/workspace/invitations/accept", async (request) => {
    const parsed = acceptInvitationSchema.parse(request.body);
    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { token: parsed.inviteToken },
      include: { workspace: { select: { id: true, name: true } } },
    });
    const collaborator = invitation
      ? null
      : await prisma.eventCollaborator.findUnique({
          where: { token: parsed.inviteToken },
          include: {
            event: { select: { id: true } },
            workspace: { select: { id: true, name: true } },
          },
        });

    if (
      !invitation ||
      invitation.email !== request.user!.email ||
      invitation.acceptedAt ||
      invitation.expires <= new Date()
    ) {
      if (
        !collaborator ||
        collaborator.email !== request.user!.email ||
        collaborator.acceptedAt ||
        collaborator.expires <= new Date()
      ) {
        const error = new Error("Invitation invalide ou expiree");
        error.name = "UnauthorizedError";
        throw error;
      }
    }

    if (invitation) {
      await prisma.$transaction([
        prisma.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: invitation.workspaceId,
              userId: request.user!.id,
            },
          },
          create: {
            workspaceId: invitation.workspaceId,
            userId: request.user!.id,
            role: invitation.role,
          },
          update: {
            role: invitation.role,
          },
        }),
        prisma.user.update({
          where: { id: request.user!.id },
          data: { defaultWorkspaceId: invitation.workspaceId },
        }),
        prisma.workspaceInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        }),
      ]);
    } else if (collaborator) {
      await prisma.eventCollaborator.update({
        where: { id: collaborator.id },
        data: {
          acceptedAt: new Date(),
          userId: request.user!.id,
        },
      });
      await prisma.user.update({
        where: { id: request.user!.id },
        data: { defaultWorkspaceId: collaborator.workspaceId },
      });
    }

    return {
      ok: true,
      workspace: invitation?.workspace ?? collaborator!.workspace,
    };
  });
}
