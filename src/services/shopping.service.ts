import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type { z } from "zod";
import type { shoppingSchema, boughtSchema, boughtWithExpenseSchema } from "../schemas/shopping.js";
import { ShoppingRepository } from "../repositories/shopping.repository.js";

type ShoppingInput = z.infer<typeof shoppingSchema>;
type BoughtInput = z.infer<typeof boughtSchema>;
type BoughtWithExpenseInput = z.infer<typeof boughtWithExpenseSchema>;

/**
 * Service métier pour le domaine courses (shopping).
 * Applique les contrôles de permissions avant de déléguer au {@link ShoppingRepository}.
 */
export class ShoppingService {
  constructor(private readonly shoppingRepository: ShoppingRepository) {}

  async list(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "shopping.read");
    return this.shoppingRepository.listItems(eventId, workspaceId);
  }

  async create(eventId: string, workspaceId: string, role: UserRole, userId: string, data: ShoppingInput) {
    requireCan(role, "shopping.write");
    return this.shoppingRepository.create(eventId, workspaceId, userId, data);
  }

  async update(id: string, workspaceId: string, role: UserRole, userId: string, data: ShoppingInput) {
    requireCan(role, "shopping.write");
    return this.shoppingRepository.update(id, workspaceId, userId, data);
  }

  async updateBought(id: string, workspaceId: string, role: UserRole, userId: string, data: BoughtInput) {
    requireCan(role, "shopping.write");
    return this.shoppingRepository.updateBought(id, workspaceId, userId, data.bought);
  }

  async buyWithExpense(
    id: string,
    workspaceId: string,
    role: UserRole,
    userId: string,
    data: BoughtWithExpenseInput,
    eventId?: string,
  ) {
    requireCan(role, "shopping.write");
    return this.shoppingRepository.buyWithExpense(id, workspaceId, userId, data, eventId);
  }

  async delete(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "shopping.write");
    return this.shoppingRepository.delete(id, workspaceId, userId);
  }

  async listPersons(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "shopping.read");
    return this.shoppingRepository.listPersons(eventId, workspaceId);
  }
}
