import type { Prisma, PrismaClient } from "@prisma/client";
import type { PersonInput } from "../schemas/person.js";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

/**
 * Filtres applicables à la liste des personnes.
 */
export type PersonFilters = {
  /** Recherche textuelle sur le nom, l'email, le téléphone et les tags. */
  search?: string;
  /** Filtre sur les tags (un ou plusieurs). */
  tags?: string[];
  /** Inclure les personnes archivées (false par défaut). */
  includeArchived?: boolean;
};

/**
 * DAO pour le modèle {@link Person}.
 * Fournit les opérations CRUD et de recherche sur la table des personnes.
 */
export class PersonDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Recherche des personnes dans un espace de travail avec filtres optionnels.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param filters - Filtres de recherche
   * @returns Liste des personnes triées par nom complet
   */
  async findMany(workspaceId: string, filters: PersonFilters = {}) {
    const { search, tags, includeArchived } = filters;

    const where: Prisma.PersonWhereInput = {
      workspaceId,
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { tags: { hasSome: [search.toLowerCase()] } },
            ],
          }
        : {}),
      ...(tags && tags.length > 0 ? { tags: { hasSome: tags } } : {}),
    };

    return this.prisma.person.findMany({ where, orderBy: { fullName: "asc" } });
  }

  /**
   * Recherche une personne par son identifiant dans un espace de travail donné.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns La personne ou `null` si absente
   */
  async findById(id: string, workspaceId: string) {
    return this.prisma.person.findFirst({ where: { id, workspaceId } });
  }

  /**
   * Recherche une personne ou lève une erreur si absente.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async findByIdOrThrow(id: string, workspaceId: string) {
    const person = await this.findById(id, workspaceId);
    if (!person) throw new NotFoundError("Personne introuvable");
    return person;
  }

  /**
   * Retourne l'ensemble des tags utilisés par les personnes actives d'un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns Liste de tags uniques triés alphabétiquement
   */
  async findTags(workspaceId: string): Promise<string[]> {
    const persons = await this.prisma.person.findMany({
      where: { workspaceId, archivedAt: null },
      select: { tags: true },
    });

    const tagSet = new Set<string>();
    for (const person of persons) {
      for (const tag of person.tags) tagSet.add(tag);
    }

    return [...tagSet].sort();
  }

  /**
   * Crée une nouvelle personne dans l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de la personne
   * @returns La personne créée
   */
  async create(workspaceId: string, data: PersonInput) {
    return this.prisma.person.create({
      data: {
        workspaceId,
        fullName: data.fullName,
        email: data.email || null,
        phone: data.phone || null,
        discordUserId: data.discordUserId || null,
        tags: data.tags,
        notes: data.notes || null,
      },
    });
  }

  /**
   * Met à jour les données d'une personne.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @returns La personne mise à jour
   */
  async update(id: string, workspaceId: string, data: PersonInput) {
    return this.prisma.person.update({
      where: { id, workspaceId },
      data: {
        fullName: data.fullName,
        email: data.email || null,
        phone: data.phone || null,
        discordUserId: data.discordUserId || null,
        tags: data.tags,
        notes: data.notes || null,
      },
    });
  }

  /**
   * Définit la date d'archivage d'une personne.
   *
   * @param id - Identifiant de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @param date - Date d'archivage, ou `null` pour restaurer
   * @returns La personne mise à jour
   */
  async setArchivedAt(id: string, workspaceId: string, date: Date | null) {
    return this.prisma.person.update({
      where: { id, workspaceId },
      data: { archivedAt: date },
    });
  }
}
