import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";

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
