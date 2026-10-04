import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type { CollectiveInput, ProfitSplitInput } from "../schemas/collective.js";
import type { CollectiveRepository } from "../repositories/collective.repository.js";

export class CollectiveService {
  constructor(private readonly collectiveRepository: CollectiveRepository) {}

  async list(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.read");
    return this.collectiveRepository.list(eventId, workspaceId);
  }

  async updateProfitSplit(eventId: string, workspaceId: string, role: UserRole, userId: string, data: ProfitSplitInput) {
    requireCan(role, "budget.write");
    return this.collectiveRepository.updateProfitSplit(eventId, workspaceId, userId, data.profitSplitMode);
  }

  async create(eventId: string, workspaceId: string, role: UserRole, userId: string, data: CollectiveInput) {
    requireCan(role, "budget.write");
    return this.collectiveRepository.create(eventId, workspaceId, userId, data);
  }

  async update(id: string, workspaceId: string, role: UserRole, userId: string, data: CollectiveInput) {
    requireCan(role, "budget.write");
    return this.collectiveRepository.update(id, workspaceId, userId, data);
  }

  async delete(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "budget.write");
    return this.collectiveRepository.delete(id, workspaceId, userId);
  }
}
