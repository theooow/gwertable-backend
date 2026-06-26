import type { PrismaClient, UserRole } from "@prisma/client";
import { UnauthorizedError } from "../lib/errors.js";
import { SessionDao } from "../dao/session.dao.js";
import { VerificationTokenDao } from "../dao/verification-token.dao.js";
import { WorkspaceInvitationDao } from "../dao/workspace-invitation.dao.js";
import { WorkspaceMemberDao } from "../dao/workspace-member.dao.js";
import { EventCollaboratorDao } from "../dao/event-collaborator.dao.js";

/** Invitation à un espace de travail. */
type WorkspaceInvitationRecord = {
  kind: "workspace";
  id: string;
  workspaceId: string;
  email: string;
  role: UserRole;
  acceptedAt: Date | null;
  expires: Date;
};

/** Invitation à un événement en tant que collaborateur. */
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

/** Union des deux types d'invitation. */
export type InvitationRecord = WorkspaceInvitationRecord | EventInvitationRecord;

/**
 * Repository pour le domaine authentification.
 *
 * Orchestre les flux d'invitation, de vérification de token et de création de session.
 * Utilise les DAOs pour les accès simples et Prisma directement pour les opérations
 * imbriquées complexes (création user + workspace en une seule transaction logique).
 */
export class AuthRepository {
  constructor(
    private readonly sessionDao: SessionDao,
    private readonly verificationTokenDao: VerificationTokenDao,
    private readonly workspaceInvitationDao: WorkspaceInvitationDao,
    private readonly workspaceMemberDao: WorkspaceMemberDao,
    private readonly eventCollaboratorDao: EventCollaboratorDao,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Recherche et valide une invitation (workspace ou événement) par son token.
   *
   * @param email - Email de l'utilisateur qui tente de se connecter
   * @param inviteToken - Token d'invitation optionnel
   * @returns L'invitation valide ou `null` si aucun token fourni
   * @throws {UnauthorizedError} Si le token est invalide, expiré, ou ne correspond pas à l'email
   */
  async getValidInvitation(
    email: string,
    inviteToken: string | undefined,
  ): Promise<InvitationRecord | null> {
    if (!inviteToken) return null;

    const workspaceInvitation = await this.workspaceInvitationDao.findByToken(inviteToken);
    if (workspaceInvitation) {
      if (
        workspaceInvitation.email !== email ||
        workspaceInvitation.acceptedAt ||
        workspaceInvitation.expires <= new Date()
      ) {
        throw new UnauthorizedError("Invitation invalide ou expiree");
      }
      return {
        kind: "workspace",
        id: workspaceInvitation.id,
        workspaceId: workspaceInvitation.workspaceId,
        email: workspaceInvitation.email,
        role: workspaceInvitation.role,
        acceptedAt: workspaceInvitation.acceptedAt,
        expires: workspaceInvitation.expires,
      };
    }

    const collaborator = await this.eventCollaboratorDao.findByToken(inviteToken);
    if (
      !collaborator ||
      collaborator.email !== email ||
      collaborator.acceptedAt ||
      collaborator.expires <= new Date()
    ) {
      throw new UnauthorizedError("Invitation invalide ou expiree");
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

  /**
   * Crée un token de vérification pour le flux magic link.
   * Supprime les anciens tokens pour cet email avant de créer le nouveau.
   *
   * @param email - Adresse email de l'utilisateur
   * @param token - Token généré
   * @param expires - Date d'expiration
   */
  async createVerificationToken(email: string, token: string, expires: Date) {
    await this.verificationTokenDao.deleteAllByIdentifier(email);
    await this.verificationTokenDao.create(email, token, expires);
  }

  /**
   * Consomme un token de vérification et nettoie les tokens expirés.
   *
   * @param email - Adresse email
   * @param token - Token à consommer
   * @param now - Date courante
   * @param maxExpires - Date d'expiration maximale autorisée
   * @returns Nombre de tokens consommés (1 = succès, 0 = invalide)
   */
  async consumeVerificationToken(
    email: string,
    token: string,
    now: Date,
    maxExpires: Date,
  ): Promise<number> {
    await this.verificationTokenDao.deleteExpired(now);
    return this.verificationTokenDao.consume(email, token, now, maxExpires);
  }

  /**
   * Retrouve ou crée un utilisateur selon l'invitation fournie.
   * Gère les cas : user existant, invitation workspace, invitation événement,
   * création de workspace par défaut pour les nouveaux comptes sans invitation.
   *
   * @param email - Adresse email de l'utilisateur
   * @param invitation - Invitation valide ou `null`
   * @returns L'utilisateur créé ou mis à jour
   */
  async findOrCreateUser(email: string, invitation: InvitationRecord | null) {
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing && invitation?.kind === "workspace") {
      return this.prisma.user.update({
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
              create: { workspaceId: invitation.workspaceId, role: invitation.role },
              update: { role: invitation.role },
            },
          },
        },
      });
    }

    if (existing && invitation?.kind === "event") {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { defaultWorkspaceId: invitation.workspaceId },
      });
    }

    if (existing?.defaultWorkspaceId) return existing;

    if (existing) {
      const workspace = await this.prisma.workspace.create({
        data: { name: existing.name ?? existing.email },
      });
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          defaultWorkspaceId: workspace.id,
          workspaceMemberships: {
            create: { workspaceId: workspace.id, role: existing.role },
          },
        },
      });
    }

    const workspace = invitation
      ? null
      : await this.prisma.workspace.create({ data: { name: email } });

    return this.prisma.user.create({
      data: {
        email,
        role: invitation?.role ?? "ADMIN",
        defaultWorkspaceId: invitation?.workspaceId ?? workspace?.id,
        ...(invitation?.kind === "workspace"
          ? {
              workspaceMemberships: {
                create: { workspaceId: invitation.workspaceId, role: invitation.role },
              },
            }
          : {
              workspaceMemberships: workspace
                ? { create: { workspaceId: workspace.id, role: "ADMIN" } }
                : undefined,
            }),
      },
    });
  }

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updatePasswordHash(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async markEmailVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: new Date() },
    });
  }

  /**
   * Accepte une invitation après connexion réussie.
   *
   * @param invitation - Invitation à accepter
   * @param userId - Identifiant de l'utilisateur ayant accepté
   */
  async acceptInvitation(invitation: InvitationRecord | null, userId: string) {
    if (!invitation) return;

    if (invitation.kind === "workspace") {
      await this.workspaceInvitationDao.accept(invitation.id);
      await this.workspaceMemberDao.upsert(invitation.workspaceId, userId, invitation.role);
      return;
    }

    await this.eventCollaboratorDao.accept(invitation.id, userId);
  }

  /**
   * Retourne le rôle et le nom de l'espace de travail pour un utilisateur.
   * Cherche d'abord dans les membres directs, puis parmi les collaborateurs d'événement.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns `{ role, workspaceName }` ou `null` si aucun accès trouvé
   */
  async getWorkspaceAccess(userId: string, workspaceId: string) {
    const membership = await this.workspaceMemberDao.findByUserAndWorkspace(workspaceId, userId);
    if (membership) {
      return { role: membership.role, workspaceName: membership.workspace.name };
    }

    const collaborator = await this.eventCollaboratorDao.findFirstAcceptedInWorkspace(
      workspaceId,
      userId,
    );
    if (!collaborator) return null;

    return { role: collaborator.role, workspaceName: collaborator.workspace.name };
  }

  /**
   * Retourne le nom d'un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns Le nom ou `null` si absent
   */
  async getWorkspaceName(workspaceId: string): Promise<string | null> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });
    return ws?.name ?? null;
  }

  /**
   * Recherche le premier espace de travail accessible via une collaboration d'événement.
   * Utilisé comme fallback quand l'utilisateur n'a pas de `defaultWorkspaceId`.
   *
   * @param userId - Identifiant de l'utilisateur
   * @returns Contexte d'accès ou `null`
   */
  async findCollaboratorWorkspace(userId: string) {
    return this.eventCollaboratorDao.findFirstAcceptedByUserId(userId);
  }

  /**
   * Crée une nouvelle session pour un utilisateur.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param sessionToken - Token de session
   * @param expires - Date d'expiration
   */
  async createSession(userId: string, sessionToken: string, expires: Date) {
    return this.sessionDao.create(userId, sessionToken, expires);
  }

  /**
   * Supprime une session (déconnexion).
   *
   * @param sessionToken - Token de la session à supprimer
   */
  async deleteSession(sessionToken: string) {
    return this.sessionDao.deleteByToken(sessionToken);
  }
}
