import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";

/**
 * DAO pour le modèle {@link VerificationToken}.
 * Gère les tokens de vérification utilisés dans le flux magic link.
 */
export class VerificationTokenDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Supprime tous les tokens existants pour un email (dédoublonnage avant création).
   *
   * @param identifier - Adresse email de l'utilisateur
   */
  async deleteAllByIdentifier(identifier: string) {
    return this.prisma.verificationToken.deleteMany({ where: { identifier } });
  }

  /**
   * Supprime les tokens expirés.
   *
   * @param now - Date de référence pour la comparaison
   */
  async deleteExpired(now: Date) {
    return this.prisma.verificationToken.deleteMany({ where: { expires: { lte: now } } });
  }

  /**
   * Crée un nouveau token de vérification.
   *
   * @param identifier - Adresse email de l'utilisateur
   * @param token - Valeur du token
   * @param expires - Date d'expiration
   */
  async create(identifier: string, token: string, expires: Date) {
    return this.prisma.verificationToken.create({ data: { identifier, token, expires } });
  }

  /**
   * Consomme un token (suppression atomique avec vérification).
   * Retourne le nombre de tokens supprimés : 1 si valide, 0 sinon.
   *
   * @param identifier - Adresse email de l'utilisateur
   * @param token - Valeur du token à consommer
   * @param now - Date courante
   * @param maxExpires - Date d'expiration maximale autorisée
   * @returns Nombre de tokens supprimés (1 = succès, 0 = invalide/expiré)
   */
  async consume(identifier: string, token: string, now: Date, maxExpires: Date): Promise<number> {
    const result = await this.prisma.verificationToken.deleteMany({
      where: {
        identifier,
        token,
        expires: { gt: now, lte: maxExpires },
      },
    });
    return result.count;
  }
}
