import type { PrismaClient, UserRole } from "@prisma/client";
import { NotFoundError, ValidationError, ConflictError, UnauthorizedError } from "../lib/errors.js";
import { WorkspaceDao } from "../dao/workspace.dao.js";
import { WorkspaceMemberDao } from "../dao/workspace-member.dao.js";
import { WorkspaceInvitationDao } from "../dao/workspace-invitation.dao.js";
import { EventCollaboratorDao } from "../dao/event-collaborator.dao.js";

/**
 * Repository pour le domaine workspace.
 * Orchestre les opérations sur les membres, invitations et paramètres de l'espace de travail.
 */
export class WorkspaceRepository {
  constructor(
    private readonly workspaceDao: WorkspaceDao,
    private readonly memberDao: WorkspaceMemberDao,
    private readonly invitationDao: WorkspaceInvitationDao,
    private readonly collaboratorDao: EventCollaboratorDao,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Retourne un espace de travail avec masquage du token Shotgun.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'espace est introuvable
   */
  async getWorkspace(workspaceId: string) {
    const workspace = await this.workspaceDao.findByIdOrThrow(workspaceId);
    return {
      ...workspace,
      shotgunConnected: Boolean(workspace.shotgunApiToken),
      shotgunApiToken: null,
    };
  }

  /**
   * Met à jour les paramètres d'un espace de travail.
   * Conserve le token Shotgun existant si aucun nouveau n'est fourni.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param name - Nouveau nom
   * @param shotgunOrganizerId - Identifiant organisateur Shotgun (optionnel)
   * @param shotgunApiToken - Token API Shotgun (optionnel, conserve l'existant si vide)
   */
  async updateWorkspace(
    workspaceId: string,
    name: string,
    shotgunOrganizerId: string | undefined,
    shotgunApiToken: string | undefined,
  ) {
    const current = await this.workspaceDao.findByIdOrThrow(workspaceId);
    const resolvedToken =
      shotgunApiToken?.trim() ? shotgunApiToken.trim() : current.shotgunApiToken ?? undefined;

    const updated = await this.workspaceDao.update(workspaceId, {
      name,
      shotgunOrganizerId: shotgunOrganizerId?.trim() || null,
      shotgunApiToken: resolvedToken,
    });

    return {
      ...updated,
      shotgunConnected: Boolean(updated.shotgunApiToken),
      shotgunApiToken: null,
    };
  }

  /**
   * Crée un espace de travail et le définit comme espace par défaut de l'utilisateur.
   *
   * @param userId - Identifiant de l'utilisateur créateur (devient ADMIN)
   * @param name - Nom de l'espace
   */
  async createWorkspace(userId: string, name: string) {
    const workspace = await this.workspaceDao.createWithAdmin(name, userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { defaultWorkspaceId: workspace.id },
    });
    return workspace;
  }

  /**
   * Supprime un espace de travail après nettoyage des références utilisateur.
   * Si l'espace a d'autres membres, migre les `defaultWorkspaceId` vers un espace de repli.
   * Sinon, supprime les données (events, personnes, équipements…) avant de supprimer l'espace.
   *
   * @param workspaceId - Identifiant de l'espace à supprimer
   * @param currentUserId - Identifiant de l'utilisateur qui demande la suppression
   * @param confirmName - Nom de confirmation (doit correspondre au nom de l'espace)
   * @throws {ValidationError} Si la confirmation ne correspond pas
   */
  async deleteWorkspace(
    workspaceId: string,
    currentUserId: string,
    confirmName: string,
  ): Promise<{ ok: true; deletedWorkspace: boolean }> {
    const workspace = await this.workspaceDao.findByIdOrThrow(workspaceId);
    if (confirmName !== workspace.name) {
      throw new ValidationError("La confirmation doit correspondre au nom de l'espace");
    }

    const nextMembership = await this.memberDao.findFirstFallback(currentUserId, workspaceId);

    const deletedWorkspace = await this.prisma.$transaction(async (tx) => {
      if (!nextMembership) {
        await tx.event.deleteMany({ where: { workspaceId } });
        await tx.equipmentItem.deleteMany({ where: { workspaceId } });
        await tx.workspaceInvitation.deleteMany({ where: { workspaceId } });
        await tx.supplier.deleteMany({ where: { workspaceId } });
        await tx.venue.deleteMany({ where: { workspaceId } });
        await tx.user.updateMany({
          where: { person: { workspaceId } },
          data: { personId: null },
        });
        await tx.person.deleteMany({ where: { workspaceId } });
        return false;
      }

      const defaultUsers = await tx.user.findMany({
        where: { defaultWorkspaceId: workspaceId },
        select: { id: true },
      });

      for (const user of defaultUsers) {
        const fallback = await tx.workspaceMember.findFirst({
          where: { userId: user.id, workspaceId: { not: workspaceId } },
          orderBy: { createdAt: "asc" },
          select: { workspaceId: true },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { defaultWorkspaceId: fallback?.workspaceId ?? null },
        });
      }

      await tx.workspace.delete({ where: { id: workspaceId } });
      return true;
    });

    return { ok: true, deletedWorkspace };
  }

  /**
   * Retourne la liste des espaces de travail accessibles par un utilisateur
   * (membres directs + collaborateurs d'événements acceptés).
   *
   * @param userId - Identifiant de l'utilisateur
   * @param email - Email de l'utilisateur
   */
  async listAccessibleWorkspaces(userId: string, email: string) {
    const [memberships, collaborators] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          workspace: {
            select: { id: true, name: true, createdAt: true, updatedAt: true },
          },
        },
      }),
      this.prisma.eventCollaborator.findMany({
        where: { acceptedAt: { not: null }, OR: [{ userId }, { email }] },
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          workspace: {
            select: { id: true, name: true, createdAt: true, updatedAt: true },
          },
        },
      }),
    ]);

    const map = new Map<
      string,
      { id: string; name: string; role: UserRole; createdAt: Date; updatedAt: Date }
    >();

    for (const m of memberships) {
      map.set(m.workspace.id, { ...m.workspace, role: m.role });
    }
    for (const c of collaborators) {
      if (!map.has(c.workspace.id)) {
        map.set(c.workspace.id, { ...c.workspace, role: c.role });
      }
    }

    return [...map.values()];
  }

  /**
   * Retourne les événements pour lesquels l'utilisateur est collaborateur accepté.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param email - Email de l'utilisateur
   */
  async listInvitedEvents(userId: string, email: string) {
    const invitations = await this.prisma.eventCollaborator.findMany({
      where: { acceptedAt: { not: null }, OR: [{ userId }, { email }] },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        event: {
          select: {
            id: true,
            name: true,
            startsAt: true,
            workspaceId: true,
            workspace: { select: { id: true, name: true } },
          },
        },
      },
    });

    const map = new Map<
      string,
      {
        eventId: string;
        eventName: string;
        startsAt: Date;
        workspaceId: string;
        workspaceName: string;
        role: UserRole;
      }
    >();

    for (const inv of invitations) {
      if (!map.has(inv.event.id)) {
        map.set(inv.event.id, {
          eventId: inv.event.id,
          eventName: inv.event.name,
          startsAt: inv.event.startsAt,
          workspaceId: inv.event.workspaceId,
          workspaceName: inv.event.workspace.name,
          role: inv.role,
        });
      }
    }

    return [...map.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  /**
   * Vérifie qu'un utilisateur a accès à un espace de travail (membre ou collaborateur).
   *
   * @param userId - Identifiant de l'utilisateur
   * @param email - Email de l'utilisateur
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async hasAccess(userId: string, email: string, workspaceId: string): Promise<boolean> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (member) return true;

    const collaborator = await this.prisma.eventCollaborator.findFirst({
      where: { workspaceId, acceptedAt: { not: null }, OR: [{ userId }, { email }] },
      select: { id: true },
    });
    return Boolean(collaborator);
  }

  /**
   * Retourne les membres et invitations en attente d'un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async getMembers(workspaceId: string) {
    const [members, invitations] = await Promise.all([
      this.memberDao.findManyWithUser(workspaceId),
      this.invitationDao.findPending(workspaceId),
    ]);
    return { members, invitations };
  }

  /**
   * Recherche un membre ou lève une erreur.
   *
   * @param memberId - Identifiant du membre
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si le membre est introuvable
   */
  async getMemberOrThrow(memberId: string, workspaceId: string) {
    const member = await this.memberDao.findByIdInWorkspace(memberId, workspaceId);
    if (!member) throw new NotFoundError("Membre introuvable");
    return member;
  }

  /**
   * Vérifie que le membre n'est pas le dernier admin avant une opération critique.
   *
   * @param memberId - Identifiant du membre
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si le membre est introuvable
   * @throws {ValidationError} Si le membre est le dernier admin
   */
  async assertNotLastAdmin(memberId: string, workspaceId: string) {
    const [member, adminCount] = await Promise.all([
      this.getMemberOrThrow(memberId, workspaceId),
      this.memberDao.count(workspaceId, "ADMIN"),
    ]);

    if (member.role === "ADMIN" && adminCount <= 1) {
      throw new ValidationError("Impossible de retirer le dernier admin du workspace");
    }

    return member;
  }

  /**
   * Met à jour le rôle d'un membre après vérification admin.
   *
   * @param memberId - Identifiant du membre
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Nouveau rôle
   * @throws {ValidationError} Si le membre est le dernier admin
   */
  async updateMemberRole(memberId: string, workspaceId: string, role: UserRole) {
    const member = await this.assertNotLastAdmin(memberId, workspaceId);
    return this.memberDao.updateRole(member.id, role);
  }

  /**
   * Retire un membre de l'espace de travail et met à jour son espace par défaut si nécessaire.
   *
   * @param memberId - Identifiant du membre
   * @param workspaceId - Identifiant de l'espace de travail
   * @param currentUserId - Identifiant de l'utilisateur courant (interdit de se supprimer soi-même)
   * @throws {ValidationError} Si le membre est le dernier admin ou tente de se supprimer lui-même
   */
  async removeMember(memberId: string, workspaceId: string, currentUserId: string) {
    const member = await this.assertNotLastAdmin(memberId, workspaceId);

    if (member.userId === currentUserId) {
      throw new ValidationError(
        "Utilise la suppression du compte pour retirer ton propre acces",
      );
    }

    await this.memberDao.delete(member.id);

    const user = await this.prisma.user.findUnique({
      where: { id: member.userId },
      select: { defaultWorkspaceId: true },
    });

    if (user?.defaultWorkspaceId === workspaceId) {
      const fallback = await this.memberDao.findFirstFallback(member.userId, workspaceId);
      await this.prisma.user.update({
        where: { id: member.userId },
        data: { defaultWorkspaceId: fallback?.workspaceId ?? null },
      });
    }
  }

  /**
   * Crée ou renouvelle une invitation pour un email dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param email - Email de l'invité
   * @param role - Rôle à assigner
   * @throws {ConflictError} Si l'email est déjà membre de l'espace
   */
  async createInvitation(workspaceId: string, email: string, role: UserRole) {
    const existing = await this.memberDao.findByEmail(workspaceId, email);
    if (existing) throw new ConflictError("Ce compte est deja membre de cet espace");

    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return this.invitationDao.upsert(workspaceId, email, role, expires);
  }

  /**
   * Accepte une invitation workspace ou événement pour un utilisateur connecté.
   *
   * @param inviteToken - Token de l'invitation
   * @param userId - Identifiant de l'utilisateur
   * @param userEmail - Email de l'utilisateur
   * @throws {UnauthorizedError} Si l'invitation est invalide, expirée ou ne correspond pas
   */
  async acceptInvitation(inviteToken: string, userId: string, userEmail: string) {
    const invitation = await this.invitationDao.findByTokenWithWorkspace(inviteToken);
    const collaborator = invitation
      ? null
      : await this.prisma.eventCollaborator.findUnique({
          where: { token: inviteToken },
          include: {
            event: { select: { id: true } },
            workspace: { select: { id: true, name: true } },
          },
        });

    const invitationValid =
      invitation &&
      invitation.email === userEmail &&
      !invitation.acceptedAt &&
      invitation.expires > new Date();

    const collaboratorValid =
      collaborator &&
      collaborator.email === userEmail &&
      !collaborator.acceptedAt &&
      collaborator.expires > new Date();

    if (!invitationValid && !collaboratorValid) {
      throw new UnauthorizedError("Invitation invalide ou expiree");
    }

    if (invitation && invitationValid) {
      await this.prisma.$transaction([
        this.prisma.workspaceMember.upsert({
          where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
          create: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
          update: { role: invitation.role },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { defaultWorkspaceId: invitation.workspaceId },
        }),
        this.prisma.workspaceInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        }),
      ]);
      return { ok: true, workspace: invitation.workspace };
    }

    await this.prisma.eventCollaborator.update({
      where: { id: collaborator!.id },
      data: { acceptedAt: new Date(), userId },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { defaultWorkspaceId: collaborator!.workspaceId },
    });

    return { ok: true, workspace: collaborator!.workspace };
  }

  /**
   * Met à jour le profil utilisateur (nom et image).
   *
   * @param userId - Identifiant de l'utilisateur
   * @param name - Nouveau nom (ou `null` pour effacer)
   * @param image - Nouvelle URL d'image (ou `null` pour effacer)
   */
  async updateAccount(userId: string, name: string | null, image: string | null) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { name, image },
      select: { id: true, email: true, name: true, image: true, role: true, personId: true },
    });
  }

  /**
   * Supprime le compte utilisateur et nettoie l'espace de travail si vide.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param workspaceId - Identifiant de l'espace de travail courant
   * @param userRole - Rôle de l'utilisateur (vérification dernier admin)
   * @throws {ValidationError} Si l'utilisateur est le seul admin d'un espace multi-membres
   */
  async deleteAccount(userId: string, workspaceId: string, userRole: UserRole) {
    const [memberCount, adminCount] = await Promise.all([
      this.memberDao.count(workspaceId),
      this.memberDao.count(workspaceId, "ADMIN"),
    ]);

    if (memberCount > 1 && userRole === "ADMIN" && adminCount <= 1) {
      throw new ValidationError("Invite un autre admin avant de supprimer ce compte");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: userId } });
      const remaining = await tx.workspaceMember.count({ where: { workspaceId } });
      if (remaining === 0) {
        await tx.user.updateMany({
          where: { defaultWorkspaceId: workspaceId },
          data: { defaultWorkspaceId: null },
        });
        await tx.workspace.delete({ where: { id: workspaceId } });
      }
    });
  }

  /**
   * Bascule l'espace de travail par défaut d'un utilisateur.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param workspaceId - Identifiant du nouvel espace par défaut
   * @throws {NotFoundError} Si l'utilisateur n'est pas membre de cet espace
   */
  async switchWorkspace(userId: string, workspaceId: string) {
    const membership = await this.memberDao.findByUserAndWorkspace(workspaceId, userId);
    if (!membership) throw new NotFoundError("Espace de travail introuvable pour ce compte");

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { defaultWorkspaceId: workspaceId },
      select: { id: true, email: true, name: true, image: true, role: true, personId: true },
    });

    return { user, membership };
  }

  /**
   * Copie les contacts actifs d'un espace source vers l'espace courant.
   * Fusionne par email ou discordUserId si la personne existe déjà.
   *
   * @param sourceWorkspaceId - Identifiant de l'espace source
   * @param targetWorkspaceId - Identifiant de l'espace cible
   * @param excludedPersonIds - Identifiants des personnes à exclure
   * @param userId - Identifiant de l'utilisateur courant
   * @param userEmail - Email de l'utilisateur courant
   * @throws {NotFoundError} Si l'utilisateur n'a pas accès à l'espace source
   */
  async transferContacts(
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    excludedPersonIds: string[],
    userId: string,
    userEmail: string,
  ) {
    const hasSourceAccess = await this.hasAccess(userId, userEmail, sourceWorkspaceId);
    if (!hasSourceAccess) throw new NotFoundError("Source introuvable");

    const sourcePeople = await this.prisma.person.findMany({
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
        ? {
            workspaceId_email: {
              workspaceId: targetWorkspaceId,
              email: person.email,
            },
          }
        : person.discordUserId
          ? {
              workspaceId_discordUserId: {
                workspaceId: targetWorkspaceId,
                discordUserId: person.discordUserId,
              },
            }
          : null;

      if (uniqueWhere) {
        const existing = await this.prisma.person.findUnique({ where: uniqueWhere });
        if (existing) {
          await this.prisma.person.update({
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

      await this.prisma.person.create({
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
}
