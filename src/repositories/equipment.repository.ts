import type { EquipmentItemInput } from "../schemas/equipment.js";
import { NotFoundError } from "../lib/errors.js";
import { EquipmentItemDao } from "../dao/equipment-item.dao.js";

/**
 * Repository pour le domaine équipement (catalogue de l'espace de travail).
 * Expose les opérations métier en s'appuyant sur {@link EquipmentItemDao}.
 */
export class EquipmentRepository {
  constructor(private readonly equipmentItemDao: EquipmentItemDao) {}

  /**
   * Retourne tous les équipements actifs d'un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listForWorkspace(workspaceId: string) {
    return this.equipmentItemDao.findAllActive(workspaceId);
  }

  /**
   * Retourne un équipement ou lève une {@link NotFoundError}.
   *
   * @param id - Identifiant de l'équipement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'équipement n'existe pas dans cet espace de travail
   */
  async findOrThrow(id: string, workspaceId: string) {
    const item = await this.equipmentItemDao.findByIdInWorkspace(id, workspaceId);
    if (!item) throw new NotFoundError("Équipement introuvable");
    return item;
  }

  /**
   * Crée un équipement dans le catalogue.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async create(workspaceId: string, data: EquipmentItemInput) {
    return this.equipmentItemDao.create(workspaceId, data);
  }

  /**
   * Met à jour un équipement après vérification de son existence.
   *
   * @param id - Identifiant de l'équipement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @throws {NotFoundError} Si l'équipement n'existe pas dans cet espace de travail
   */
  async update(id: string, workspaceId: string, data: EquipmentItemInput) {
    await this.findOrThrow(id, workspaceId);
    return this.equipmentItemDao.update(id, data);
  }

  /**
   * Archive un équipement après vérification de son existence.
   *
   * @param id - Identifiant de l'équipement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'équipement n'existe pas dans cet espace de travail
   */
  async archive(id: string, workspaceId: string) {
    await this.findOrThrow(id, workspaceId);
    return this.equipmentItemDao.archive(id);
  }
}
