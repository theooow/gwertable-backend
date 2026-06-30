import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { WorkspaceDao } from "../dao/workspace.dao.js";
import { WorkspaceMemberDao } from "../dao/workspace-member.dao.js";
import { WorkspaceInvitationDao } from "../dao/workspace-invitation.dao.js";
import { EventCollaboratorDao } from "../dao/event-collaborator.dao.js";
import { WorkspaceRepository } from "../repositories/workspace.repository.js";
import { WorkspaceService } from "../services/workspace.service.js";

const inviteSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  role: z.enum(["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"]),
});
const workspaceMemberParamsSchema = z.object({ memberId: z.string().min(1) });
const updateWorkspaceMemberSchema = z.object({
  role: z.enum(["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"]),
});
const shortText = z.string().trim().max(120).optional().or(z.literal(""));
const addressText = z.string().trim().max(240).optional().or(z.literal(""));
const optionalEmail = z.string().trim().email().optional().or(z.literal(""));
const hexColor = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).optional().or(z.literal(""));

const updateAccountSchema = z.object({
  name: shortText,
  image: z.string().trim().max(2000).optional().or(z.literal("")),
  firstName: shortText,
  lastName: shortText,
  phone: shortText,
  addressLine1: addressText,
  addressLine2: addressText,
  postalCode: shortText,
  city: shortText,
  country: shortText,
  companyName: shortText,
  companyAddressLine1: addressText,
  companyAddressLine2: addressText,
  companyPostalCode: shortText,
  companyCity: shortText,
  companyCountry: shortText,
  companySiret: shortText,
  companyVatNumber: shortText,
  billingEmail: optionalEmail,
  locale: shortText,
  currency: shortText,
  timezone: shortText,
  emailNotificationsEnabled: z.boolean().optional(),
  taskReminderNotificationsEnabled: z.boolean().optional(),
  eventReminderNotificationsEnabled: z.boolean().optional(),
  marketingNotificationsEnabled: z.boolean().optional(),
  themeMode: z.enum(["system", "light", "dark"]).optional(),
  themePreset: z.enum(["default", "ruby", "violet", "crimson", "custom"]).optional(),
  themePrimaryColor: hexColor,
});
const profileImageUploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  data: z.string().min(1),
});
const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Le nom de l'espace est requis").max(120),
  shotgunOrganizerId: z.string().trim().max(120).optional().or(z.literal("")),
  shotgunApiToken: z.string().trim().max(2000).optional().or(z.literal("")),
});
const switchWorkspaceSchema = z.object({ workspaceId: z.string().min(1) });
const contactTransferSchema = z.object({
  sourceWorkspaceId: z.string().min(1),
  excludedPersonIds: z.array(z.string().min(1)).default([]),
});
const deleteConfirmationSchema = z.object({ confirm: z.string() });
const acceptInvitationSchema = z.object({ inviteToken: z.string().min(1) });

function nullableString(value: string | undefined) {
  if (value === undefined) return undefined;
  return value || null;
}

const allowedProfileImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

function extensionForContentType(contentType: string) {
  switch (contentType) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "image/gif": return ".gif";
    default: return "";
  }
}

const service = new WorkspaceService(
  new WorkspaceRepository(
    new WorkspaceDao(prisma),
    new WorkspaceMemberDao(prisma),
    new WorkspaceInvitationDao(prisma),
    new EventCollaboratorDao(prisma),
    prisma,
  ),
);

export async function workspaceRoutes(fastify: FastifyInstance) {
  fastify.get("/uploads/profile-images/:fileName", async (request, reply) => {
    const { fileName } = z.object({ fileName: z.string().min(1) }).parse(request.params);
    if (fileName.includes("/") || fileName.includes("\\")) throw new NotFoundError("Image de profil introuvable");

    const filePath = path.join(uploadRoot, "profile-images", fileName);
    const data = await readFile(filePath).catch(() => null);
    if (!data) throw new NotFoundError("Image de profil introuvable");

    const extension = path.extname(fileName);
    const contentType =
      extension === ".jpg" ? "image/jpeg" :
      extension === ".png" ? "image/png" :
      extension === ".webp" ? "image/webp" :
      extension === ".gif" ? "image/gif" :
      "application/octet-stream";
    return reply.type(contentType).send(data);
  });

  fastify.post("/api/uploads/profile-images", async (request, reply) => {
    const parsed = profileImageUploadSchema.parse(request.body);
    if (!allowedProfileImageTypes.has(parsed.contentType)) {
      throw new ValidationError("Format d'image de profil non supporte");
    }

    const buffer = Buffer.from(parsed.data, "base64");
    if (buffer.byteLength > 2 * 1024 * 1024) {
      throw new ValidationError("L'image de profil ne doit pas depasser 2 Mo");
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

  fastify.get("/api/account", async (request) => ({ user: request.user }));

  fastify.put("/api/account", async (request) => {
    const parsed = updateAccountSchema.parse(request.body);
    const user = await service.updateAccount(request.user!.id, {
      name: nullableString(parsed.name),
      image: nullableString(parsed.image),
      firstName: nullableString(parsed.firstName),
      lastName: nullableString(parsed.lastName),
      phone: nullableString(parsed.phone),
      addressLine1: nullableString(parsed.addressLine1),
      addressLine2: nullableString(parsed.addressLine2),
      postalCode: nullableString(parsed.postalCode),
      city: nullableString(parsed.city),
      country: nullableString(parsed.country),
      companyName: nullableString(parsed.companyName),
      companyAddressLine1: nullableString(parsed.companyAddressLine1),
      companyAddressLine2: nullableString(parsed.companyAddressLine2),
      companyPostalCode: nullableString(parsed.companyPostalCode),
      companyCity: nullableString(parsed.companyCity),
      companyCountry: nullableString(parsed.companyCountry),
      companySiret: nullableString(parsed.companySiret),
      companyVatNumber: nullableString(parsed.companyVatNumber),
      billingEmail: nullableString(parsed.billingEmail),
      locale: parsed.locale || undefined,
      currency: parsed.currency || undefined,
      timezone: parsed.timezone || undefined,
      emailNotificationsEnabled: parsed.emailNotificationsEnabled,
      taskReminderNotificationsEnabled: parsed.taskReminderNotificationsEnabled,
      eventReminderNotificationsEnabled: parsed.eventReminderNotificationsEnabled,
      marketingNotificationsEnabled: parsed.marketingNotificationsEnabled,
      themeMode: parsed.themeMode,
      themePreset: parsed.themePreset,
      themePrimaryColor: nullableString(parsed.themePrimaryColor),
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
    await service.deleteAccount(
      request.user!.id,
      request.workspaceId,
      request.userRole,
      parsed.confirm,
      request.user!.email,
    );
    return { ok: true };
  });

  fastify.get("/api/workspace", async (request) => ({
    workspace: await service.getWorkspace(request.workspaceId),
  }));

  fastify.get("/api/workspaces", async (request) => ({
    workspaces: await service.listWorkspaces(
      request.user!.id,
      request.user!.email,
      request.workspaceId,
    ),
  }));

  fastify.get("/api/workspace/invited-events", async (request) => ({
    events: await service.listInvitedEvents(
      request.userRole,
      request.user!.id,
      request.user!.email,
    ),
  }));

  fastify.post("/api/workspace/contacts/transfer", async (request) => {
    const parsed = contactTransferSchema.parse(request.body);
    const stats = await service.transferContacts(
      parsed.sourceWorkspaceId,
      request.workspaceId,
      parsed.excludedPersonIds,
      request.userRole,
      request.user!.id,
      request.user!.email,
    );
    return { ok: true, ...stats };
  });

  fastify.post("/api/workspaces", async (request, reply) => {
    const parsed = updateWorkspaceSchema.parse(request.body);
    const workspace = await service.createWorkspace(request.user!.id, parsed.name);
    return reply.status(201).send({ workspace });
  });

  fastify.put("/api/account/workspace", async (request) => {
    const { workspaceId } = switchWorkspaceSchema.parse(request.body);
    const { user, membership } = await service.switchWorkspace(request.user!.id, workspaceId);
    return {
      user: {
        ...user,
        role: membership.role,
        workspaceId: membership.workspace.name ? workspaceId : workspaceId,
        workspaceName: membership.workspace.name,
      },
    };
  });

  fastify.put("/api/workspace", async (request) => {
    const parsed = updateWorkspaceSchema.parse(request.body);
    return {
      workspace: await service.updateWorkspace(
        request.workspaceId,
        request.userRole,
        parsed.name,
        parsed.shotgunOrganizerId || undefined,
        parsed.shotgunApiToken || undefined,
      ),
    };
  });

  fastify.delete("/api/workspace", async (request) => {
    const parsed = deleteConfirmationSchema.parse(request.body);
    return service.deleteWorkspace(
      request.workspaceId,
      request.userRole,
      request.user!.id,
      parsed.confirm,
    );
  });

  fastify.get("/api/workspace/members", async (request) => {
    const { members, invitations } = await service.getMembers(
      request.workspaceId,
      request.userRole,
    );

    return {
      members: members.map((m) => ({ id: m.id, role: m.role, createdAt: m.createdAt, user: m.user })),
      invitations: invitations.map((inv) => {
        const inviteUrl = new URL("/login", env.FRONTEND_URL);
        inviteUrl.searchParams.set("invite", inv.token);
        return {
          id: inv.id,
          email: inv.email,
          role: inv.role,
          expires: inv.expires,
          createdAt: inv.createdAt,
          inviteUrl: inviteUrl.toString(),
        };
      }),
    };
  });

  fastify.put("/api/workspace/members/:memberId", async (request) => {
    const { memberId } = workspaceMemberParamsSchema.parse(request.params);
    const { role: newRole } = updateWorkspaceMemberSchema.parse(request.body);
    return service.updateMemberRole(memberId, request.workspaceId, request.userRole, newRole);
  });

  fastify.delete("/api/workspace/members/:memberId", async (request) => {
    const { memberId } = workspaceMemberParamsSchema.parse(request.params);
    await service.removeMember(memberId, request.workspaceId, request.userRole, request.user!.id);
    return { ok: true };
  });

  fastify.post("/api/workspace/invitations", async (request, reply) => {
    const parsed = inviteSchema.parse(request.body);
    const invitation = await service.createInvitation(
      request.workspaceId,
      request.userRole,
      parsed.email,
      parsed.role,
    );

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
    const { inviteToken } = acceptInvitationSchema.parse(request.body);
    return service.acceptInvitation(inviteToken, request.user!.id, request.user!.email);
  });
}
