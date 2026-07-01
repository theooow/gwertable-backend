import type { UsagePlan, UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type {
  EquipmentBulkImportInput,
  EquipmentImportConfirmInput,
  EquipmentImportPreviewInput,
  EquipmentItemInput,
  EquipmentQuoteInput,
  EquipmentUsageInput,
  EquipmentUsageUpdateInput,
} from "../schemas/equipment.js";
import { EquipmentRepository } from "../repositories/equipment.repository.js";
import { previewEquipmentDocument } from "./document-extraction.service.js";
import { requirePlanFeature } from "../lib/usage-plans.js";

/**
 * Service métier pour le domaine équipement.
 * Couvre le catalogue (espace de travail) et les usages événement (usages + devis).
 * Applique les contrôles de permissions avant de déléguer au {@link EquipmentRepository}.
 */
export class EquipmentService {
  constructor(private readonly equipmentRepository: EquipmentRepository) {}

  // ── Catalogue ────────────────────────────────────────────────────────────────

  /**
   * Retourne la liste des équipements actifs d'un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async list(workspaceId: string, role: UserRole) {
    requireCan(role, "equipment.read");
    return this.equipmentRepository.listForWorkspace(workspaceId);
  }

  /**
   * Crée un équipement dans le catalogue.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de l'équipement
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async create(workspaceId: string, role: UserRole, data: EquipmentItemInput) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.create(workspaceId, data);
  }

  /**
   * Met à jour un équipement existant.
   *
   * @param id - Identifiant de l'équipement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de mise à jour
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   * @throws {NotFoundError} Si l'équipement est introuvable
   */
  async update(id: string, workspaceId: string, role: UserRole, data: EquipmentItemInput) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.update(id, workspaceId, data);
  }

  /**
   * Archive un équipement (suppression logique).
   *
   * @param id - Identifiant de l'équipement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   * @throws {NotFoundError} Si l'équipement est introuvable
   */
  async archive(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.archive(id, workspaceId);
  }

  // ── Usages événement ─────────────────────────────────────────────────────────

  /**
   * Retourne les usages d'équipement d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async listUsages(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "equipment.read");
    return this.equipmentRepository.listUsages(eventId, workspaceId);
  }

  /**
   * Crée un usage d'équipement sur un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées (library ou oneoff)
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async createUsage(eventId: string, workspaceId: string, role: UserRole, data: EquipmentUsageInput) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.createUsage(eventId, workspaceId, data);
  }

  async bulkImportLibraryUsages(eventId: string, workspaceId: string, role: UserRole, data: EquipmentBulkImportInput) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.bulkImportLibraryUsages(eventId, workspaceId, data);
  }

  /**
   * Met à jour un usage d'équipement.
   *
   * @param usageId - Identifiant de l'usage
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées de mise à jour
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async updateUsage(usageId: string, eventId: string, workspaceId: string, role: UserRole, data: EquipmentUsageUpdateInput) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.updateUsage(usageId, eventId, workspaceId, data);
  }

  /**
   * Supprime un usage d'équipement.
   *
   * @param usageId - Identifiant de l'usage
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async deleteUsage(usageId: string, eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "equipment.write");
    await this.equipmentRepository.deleteUsage(usageId, eventId, workspaceId);
    return { ok: true };
  }

  // ── Devis équipement ─────────────────────────────────────────────────────────

  /**
   * Retourne les devis d'équipement d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture
   */
  async listQuotes(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "equipment.read");
    return this.equipmentRepository.listQuotes(eventId, workspaceId);
  }

  /**
   * Crée un devis d'équipement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async createQuote(eventId: string, workspaceId: string, role: UserRole, data: EquipmentQuoteInput) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.createQuote(eventId, workspaceId, data);
  }

  /**
   * Met à jour un devis d'équipement.
   *
   * @param quoteId - Identifiant du devis
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param data - Données validées
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async updateQuote(quoteId: string, eventId: string, workspaceId: string, role: UserRole, data: EquipmentQuoteInput) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.updateQuote(quoteId, eventId, workspaceId, data);
  }

  /**
   * Supprime un devis d'équipement.
   *
   * @param quoteId - Identifiant du devis
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async deleteQuote(quoteId: string, eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "equipment.write");
    await this.equipmentRepository.deleteQuote(quoteId, eventId, workspaceId);
    return { ok: true };
  }

  /**
   * Attache un fichier à un devis d'équipement.
   *
   * @param quoteId - Identifiant du devis
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param fileUrl - URL du fichier uploadé
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture
   */
  async attachQuoteFile(quoteId: string, eventId: string, workspaceId: string, role: UserRole, fileUrl: string) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.attachQuoteFile(quoteId, eventId, workspaceId, fileUrl);
  }

  async previewDocumentImport(workspaceId: string, role: UserRole, usagePlan: UsagePlan, data: EquipmentImportPreviewInput) {
    requireCan(role, "equipment.write");
    requirePlanFeature(usagePlan, "ai.documentImport");
    const preview = await previewEquipmentDocument({
      fileName: data.fileName,
      contentType: data.contentType,
      dataBase64: data.data,
    });
    return this.equipmentRepository.enrichDocumentImportPreview(workspaceId, preview);
  }

  async confirmDocumentImport(
    eventId: string,
    workspaceId: string,
    role: UserRole,
    data: EquipmentImportConfirmInput,
    fileUrl: string,
  ) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.createQuoteWithOneOffUsages(eventId, workspaceId, {
      label: data.label,
      amountInputMode: data.amountInputMode,
      vatRateBasisPoints: data.vatRateBasisPoints,
      discountCents: data.discountCents ?? null,
      discountPct: data.discountPct ?? null,
      fileUrl,
      supplierName: data.supplierName ?? null,
      supplierId: data.supplierId ?? null,
      createSupplierName: data.createSupplierName ?? null,
      lines: data.lines.map((line) => ({
        name: line.name,
        category: line.category,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        amountInputMode: line.amountInputMode,
        vatRateBasisPoints: line.vatRateBasisPoints,
        rentalCoef: line.rentalCoef,
        matchedItemId: line.matchedItemId ?? null,
        createCatalogItem: line.createCatalogItem ?? false,
        supplierId: line.supplierId ?? null,
        createSupplierName: line.createSupplierName ?? null,
        notes: line.notes ?? null,
      })),
    });
  }

  async importFromWorkspace(
    targetWorkspaceId: string,
    sourceWorkspaceId: string,
    itemIds: string[],
    role: UserRole,
  ) {
    requireCan(role, "equipment.write");
    return this.equipmentRepository.importFromWorkspace(targetWorkspaceId, sourceWorkspaceId, itemIds);
  }
}
