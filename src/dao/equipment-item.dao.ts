import type { PrismaClient } from "@prisma/client";
import type { EquipmentItemInput } from "../schemas/equipment.js";
import { BaseDao } from "./base.dao.js";

const ownerSelect = { id: true, fullName: true } as const;

const defaultInclude = { owner: { select: ownerSelect } } as const;

const defaultOrderBy = [{ category: "asc" as const }, { name: "asc" as const }];

/**
 * DAO pour le modèle {@link EquipmentItem}.
 * Fournit les opérations CRUD sur la table des équipements du catalogue.
 */
export class EquipmentItemDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Recherche tous les équipements non archivés d'un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns Liste des équipements triés par catégorie puis par nom
   */
  async findAllActive(workspaceId: string) {
    return this.prisma.equipmentItem.findMany({
      where: { workspaceId, archivedAt: null },
      include: defaultInclude,
      orderBy: defaultOrderBy,
    });
  }

  /**
   * Recherche un équipement par son identifiant dans un espace de travail donné.
   *
   * @param id - Identifiant de l'équipement
   * @param workspaceId - Identifiant de l'espace de travail
   * @returns L'équipement trouvé, ou `null` s'il n'existe pas
   */
  async findByIdInWorkspace(id: string, workspaceId: string) {
    return this.prisma.equipmentItem.findUnique({
      where: { id, workspaceId },
      include: defaultInclude,
    });
  }

  /**
   * Crée un nouvel équipement dans le catalogue.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de l'équipement
   * @returns L'équipement créé
   */
  async create(workspaceId: string, data: EquipmentItemInput) {
    return this.prisma.equipmentItem.create({
      data: {
        workspaceId,
        name: data.name,
        category: data.category,
        ownership: data.ownership,
        ownerId: data.ownerId ?? null,
        unitPriceCents: data.unitPriceCents,
        rentalCoef: data.rentalCoef,
        quantity: data.quantity,
        notes: data.notes || null,
      },
      include: defaultInclude,
    });
  }

  /**
   * Met à jour un équipement existant.
   *
   * @param id - Identifiant de l'équipement
   * @param data - Données validées de mise à jour
   * @returns L'équipement mis à jour
   */
  async update(id: string, data: EquipmentItemInput) {
    return this.prisma.equipmentItem.update({
      where: { id },
      data: {
        name: data.name,
        category: data.category,
        ownership: data.ownership,
        ownerId: data.ownerId ?? null,
        unitPriceCents: data.unitPriceCents,
        rentalCoef: data.rentalCoef,
        quantity: data.quantity,
        notes: data.notes || null,
      },
      include: defaultInclude,
    });
  }

  /**
   * Archive un équipement en définissant sa date d'archivage.
   *
   * @param id - Identifiant de l'équipement
   * @returns L'équipement archivé
   */
  async archive(id: string) {
    return this.prisma.equipmentItem.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
