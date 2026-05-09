import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

/**
 * DAO pour le modèle {@link ShoppingItem}.
 * Fournit les opérations CRUD sur les articles de courses d'un événement.
 */
export class ShoppingDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Retourne les articles de courses d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findMany(eventId: string, workspaceId: string) {
    return this.prisma.shoppingItem.findMany({
      where: { eventId, event: { workspaceId } },
      include: { buyer: { select: { id: true, fullName: true } } },
      orderBy: [{ bought: "asc" }, { category: "asc" }, { name: "asc" }],
    });
  }

  /**
   * Recherche un article par son identifiant dans un espace de travail.
   *
   * @param id - Identifiant de l'article
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns L'article ou `null` s'il est absent
   */
  async findByIdInWorkspace(id: string, workspaceId: string) {
    return this.prisma.shoppingItem.findFirst({
      where: { id, event: { workspaceId } },
      select: { id: true, eventId: true, name: true, expenseId: true },
    });
  }

  /**
   * Recherche un article ou lève une erreur.
   *
   * @param id - Identifiant de l'article
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'article est introuvable
   */
  async findByIdOrThrow(id: string, workspaceId: string) {
    const item = await this.findByIdInWorkspace(id, workspaceId);
    if (!item) throw new NotFoundError("Article introuvable");
    return item;
  }
}
