import type { PrismaClient, UserRole } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { randomToken } from "../lib/token.js";

/**
 * DAO pour le modèle {@link WorkspaceInvitation}.
 * Gère les invitations d'accès à un espace de travail.
 */
export class WorkspaceInvitationDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Recherche une invitation par son token unique.
   *
   * @param token - Token de l'invitation
   * @returns L'invitation ou `null` si absente
   */
  async findByToken(token: string) {
    return this.prisma.workspaceInvitation.findUnique({ where: { token } });
  }

  /**
   * Recherche une invitation par son token, avec l'espace de travail associé.
   *
   * @param token - Token de l'invitation
   */
  async findByTokenWithWorkspace(token: string) {
    return this.prisma.workspaceInvitation.findUnique({
      where: { token },
      include: { workspace: { select: { id: true, name: true } } },
    });
  }

  /**
   * Retourne les invitations en attente d'un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findPending(workspaceId: string) {
    return this.prisma.workspaceInvitation.findMany({
      where: {
        workspaceId,
        acceptedAt: null,
        expires: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Crée ou renouvelle une invitation pour un email dans un espace de travail.
   * Réinitialise le token et la date d'expiration si l'invitation existe déjà.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param email - Email de l'invité
   * @param role - Rôle à assigner
   * @param expires - Date d'expiration
   */
  async upsert(workspaceId: string, email: string, role: UserRole, expires: Date) {
    return this.prisma.workspaceInvitation.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: { workspaceId, email, role, token: randomToken(), expires },
      update: { role, token: randomToken(), expires, acceptedAt: null },
    });
  }

  /**
   * Marque une invitation comme acceptée.
   *
   * @param id - Identifiant de l'invitation
   */
  async accept(id: string) {
    return this.prisma.workspaceInvitation.update({
      where: { id },
      data: { acceptedAt: new Date() },
    });
  }
}
