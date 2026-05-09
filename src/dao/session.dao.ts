import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";

/**
 * DAO pour le modèle {@link Session}.
 * Fournit les opérations de création et suppression des sessions utilisateur.
 */
export class SessionDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Crée une nouvelle session pour un utilisateur.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param sessionToken - Token de session généré aléatoirement
   * @param expires - Date d'expiration de la session
   * @returns La session créée
   */
  async create(userId: string, sessionToken: string, expires: Date) {
    return this.prisma.session.create({ data: { sessionToken, userId, expires } });
  }

  /**
   * Supprime une session par son token.
   *
   * @param sessionToken - Token de la session à supprimer
   */
  async deleteByToken(sessionToken: string) {
    return this.prisma.session.deleteMany({ where: { sessionToken } });
  }
}
