import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";

/**
 * DAO pour le modèle {@link EventCollaborator}.
 * Gère les collaborateurs externes invités sur des événements spécifiques.
 */
export class EventCollaboratorDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Recherche un collaborateur par son token d'invitation.
   *
   * @param token - Token de l'invitation
   * @returns Le collaborateur avec l'espace de travail associé, ou `null` si absent
   */
  async findByToken(token: string) {
    return this.prisma.eventCollaborator.findUnique({
      where: { token },
      include: { event: { select: { workspaceId: true } } },
    });
  }

  /**
   * Marque un collaborateur comme ayant accepté l'invitation et lie son compte.
   *
   * @param id - Identifiant du collaborateur
   * @param userId - Identifiant de l'utilisateur ayant accepté
   */
  async accept(id: string, userId: string) {
    return this.prisma.eventCollaborator.update({
      where: { id },
      data: { acceptedAt: new Date(), userId },
    });
  }

  /**
   * Recherche le premier accès collaborateur accepté pour un utilisateur.
   * Utilisé comme source de vérité de l'espace de travail par défaut.
   *
   * @param userId - Identifiant de l'utilisateur
   * @returns Le collaborateur avec son espace de travail, ou `null` si absent
   */
  async findFirstAcceptedByUserId(userId: string) {
    return this.prisma.eventCollaborator.findFirst({
      where: { acceptedAt: { not: null }, userId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        workspaceId: true,
        workspace: { select: { name: true } },
      },
    });
  }

  /**
   * Recherche le premier accès collaborateur accepté pour un utilisateur dans un workspace.
   * Utilisé pour déterminer le rôle d'un collaborateur dans le plugin d'auth.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param userId - Identifiant de l'utilisateur
   * @returns Le collaborateur ou `null`
   */
  async findFirstAcceptedInWorkspace(workspaceId: string, userId: string) {
    return this.prisma.eventCollaborator.findFirst({
      where: { workspaceId, acceptedAt: { not: null }, userId },
      orderBy: { createdAt: "asc" },
      select: { role: true, workspace: { select: { name: true } } },
    });
  }
}
