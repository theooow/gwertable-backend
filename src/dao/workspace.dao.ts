import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

/**
 * DAO pour le modèle {@link Workspace}.
 * Fournit les opérations CRUD sur les espaces de travail.
 */
export class WorkspaceDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Recherche un espace de travail par son identifiant avec les champs publics.
   *
   * @param id - Identifiant de l'espace de travail
   * @returns L'espace de travail ou `null` s'il est absent
   */
  async findById(id: string) {
    return this.prisma.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        shotgunOrganizerId: true,
        shotgunApiToken: true,
      },
    });
  }

  /**
   * Recherche un espace de travail ou lève une erreur.
   *
   * @param id - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'espace est introuvable
   */
  async findByIdOrThrow(id: string) {
    const workspace = await this.findById(id);
    if (!workspace) throw new NotFoundError("Espace de travail introuvable");
    return workspace;
  }

  /**
   * Crée un espace de travail avec un premier membre admin.
   *
   * @param name - Nom de l'espace
   * @param adminUserId - Identifiant de l'utilisateur admin initial
   * @returns L'espace créé (sans données Shotgun)
   */
  async createWithAdmin(name: string, adminUserId: string) {
    return this.prisma.workspace.create({
      data: {
        name,
        members: { create: { userId: adminUserId, role: "ADMIN" } },
      },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
  }

  /**
   * Met à jour les informations d'un espace de travail.
   *
   * @param id - Identifiant de l'espace
   * @param data - Données de mise à jour
   */
  async update(
    id: string,
    data: {
      name: string;
      shotgunOrganizerId: string | null;
      shotgunApiToken: string | undefined;
    },
  ) {
    return this.prisma.workspace.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        shotgunOrganizerId: true,
        shotgunApiToken: true,
      },
    });
  }

  /**
   * Supprime un espace de travail.
   *
   * @param id - Identifiant de l'espace
   */
  async delete(id: string) {
    return this.prisma.workspace.delete({ where: { id } });
  }
}
