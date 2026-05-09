import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

/**
 * DAO pour le modèle {@link Venue}.
 * Fournit les opérations CRUD sur la table des lieux.
 */
export class VenueDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Retourne tous les lieux actifs d'un espace de travail, triés par nom.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findAllActive(workspaceId: string) {
    return this.prisma.venue.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Recherche un lieu par son identifiant dans un espace de travail donné.
   *
   * @param id - Identifiant du lieu
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns Le lieu ou `null` s'il n'existe pas
   */
  async findById(id: string, workspaceId: string) {
    return this.prisma.venue.findFirst({ where: { id, workspaceId }, select: { id: true } });
  }

  /**
   * Recherche un lieu ou lève une erreur s'il est absent.
   *
   * @param id - Identifiant du lieu
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si le lieu est introuvable
   */
  async findByIdOrThrow(id: string, workspaceId: string) {
    const venue = await this.findById(id, workspaceId);
    if (!venue) throw new NotFoundError("Lieu introuvable");
    return venue;
  }

  /**
   * Crée un nouveau lieu dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param name - Nom du lieu
   * @returns Le lieu créé
   */
  async create(workspaceId: string, name: string) {
    return this.prisma.venue.create({ data: { name, workspaceId } });
  }
}
