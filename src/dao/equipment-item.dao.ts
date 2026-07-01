import type { PrismaClient } from "@prisma/client";
import type { EquipmentItemInput } from "../schemas/equipment.js";
import { BaseDao } from "./base.dao.js";

const personSelect = { id: true, fullName: true } as const;

const defaultInclude = {
  owner: { select: personSelect },
  supplier: { select: personSelect },
} as const;

const defaultOrderBy = [{ category: "asc" as const }, { name: "asc" as const }];

/**
 * DAO pour le modèle {@link EquipmentItem}.
 * Fournit les opérations CRUD sur la table des équipements du catalogue.
 */
export class EquipmentItemDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  async findAllActive(workspaceId: string) {
    return this.prisma.equipmentItem.findMany({
      where: { workspaceId, archivedAt: null },
      include: defaultInclude,
      orderBy: defaultOrderBy,
    });
  }

  async findByIdInWorkspace(id: string, workspaceId: string) {
    return this.prisma.equipmentItem.findUnique({
      where: { id, workspaceId },
      include: defaultInclude,
    });
  }

  async create(workspaceId: string, data: EquipmentItemInput) {
    return this.prisma.equipmentItem.create({
      data: {
        workspaceId,
        name: data.name,
        category: data.category,
        ownership: data.ownership,
        ownerId: data.ownerId ?? null,
        supplierId: data.supplierId ?? null,
        photoUrl: data.photoUrl ?? null,
        color: data.color ?? null,
        unitPriceCents: data.unitPriceCents,
        amountInputMode: data.amountInputMode,
        vatRateBasisPoints: data.vatRateBasisPoints,
        rentalCoef: data.rentalCoef,
        quantity: data.quantity,
        notes: data.notes || null,
      },
      include: defaultInclude,
    });
  }

  async update(id: string, data: EquipmentItemInput) {
    return this.prisma.equipmentItem.update({
      where: { id },
      data: {
        name: data.name,
        category: data.category,
        ownership: data.ownership,
        ownerId: data.ownerId ?? null,
        supplierId: data.supplierId ?? null,
        photoUrl: data.photoUrl ?? null,
        color: data.color ?? null,
        unitPriceCents: data.unitPriceCents,
        amountInputMode: data.amountInputMode,
        vatRateBasisPoints: data.vatRateBasisPoints,
        rentalCoef: data.rentalCoef,
        quantity: data.quantity,
        notes: data.notes || null,
      },
      include: defaultInclude,
    });
  }

  async archive(id: string) {
    return this.prisma.equipmentItem.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
