import type { PrismaClient, UserRole } from "@prisma/client";
import { BaseDao } from "./base.dao.js";

/**
 * DAO pour le modèle {@link WorkspaceMember}.
 * Gère l'appartenance des utilisateurs aux espaces de travail.
 */
export class WorkspaceMemberDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Recherche l'appartenance d'un utilisateur à un espace de travail avec son rôle.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param userId - Identifiant de l'utilisateur
   * @returns L'appartenance ou `null` si absente
   */
  async findByUserAndWorkspace(workspaceId: string, userId: string) {
    return this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true, workspace: { select: { name: true } } },
    });
  }

  /**
   * Crée ou met à jour l'appartenance d'un utilisateur à un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param userId - Identifiant de l'utilisateur
   * @param role - Rôle à assigner
   */
  async upsert(workspaceId: string, userId: string, role: UserRole) {
    return this.prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, role },
      update: { role },
    });
  }
}
