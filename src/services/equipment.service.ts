import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type { EquipmentItemInput } from "../schemas/equipment.js";
import { EquipmentRepository } from "../repositories/equipment.repository.js";

/**
 * Service métier pour le domaine équipement (catalogue de l'espace de travail).
 * Applique les contrôles de permissions avant de déléguer au {@link EquipmentRepository}.
 */
export class EquipmentService {
  constructor(private readonly equipmentRepository: EquipmentRepository) {}

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
}
