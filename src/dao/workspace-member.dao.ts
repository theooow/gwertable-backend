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
   * Recherche un membre par son identifiant dans un espace de travail.
   *
   * @param id - Identifiant du membre
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns Le membre ou `null` s'il est absent
   */
  async findByIdInWorkspace(id: string, workspaceId: string) {
    return this.prisma.workspaceMember.findFirst({
      where: { id, workspaceId },
      select: { id: true, userId: true, role: true },
    });
  }

  /**
   * Retourne tous les membres d'un espace de travail avec les informations utilisateur.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findManyWithUser(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, email: true, name: true, image: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Compte les membres selon des critères.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Filtre optionnel sur le rôle
   */
  async count(workspaceId: string, role?: UserRole) {
    return this.prisma.workspaceMember.count({
      where: { workspaceId, ...(role ? { role } : {}) },
    });
  }

  /**
   * Recherche le premier membre d'un utilisateur en dehors d'un workspace donné.
   * Utilisé pour trouver un espace de travail de repli.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param excludeWorkspaceId - Identifiant du workspace à exclure
   */
  async findFirstFallback(userId: string, excludeWorkspaceId: string) {
    return this.prisma.workspaceMember.findFirst({
      where: { userId, workspaceId: { not: excludeWorkspaceId } },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });
  }

  /**
   * Vérifie si un utilisateur est déjà membre via son email.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param email - Email de l'utilisateur
   */
  async findByEmail(workspaceId: string, email: string) {
    return this.prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email } },
      select: { id: true },
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

  /**
   * Met à jour le rôle d'un membre.
   *
   * @param id - Identifiant du membre
   * @param role - Nouveau rôle
   */
  async updateRole(id: string, role: UserRole) {
    return this.prisma.workspaceMember.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true, image: true, role: true } },
      },
    });
  }

  /**
   * Supprime un membre de l'espace de travail.
   *
   * @param id - Identifiant du membre
   */
  async delete(id: string) {
    return this.prisma.workspaceMember.delete({ where: { id } });
  }
}
