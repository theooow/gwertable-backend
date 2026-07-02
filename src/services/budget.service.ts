import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import type { z } from "zod";
import type { expenseSchema } from "../schemas/expense.js";
import type { incomeSchema } from "../schemas/income.js";
import type { ticketTierSchema } from "../schemas/ticket-tier.js";
import type { consumableSchema } from "../schemas/consumable.js";
import { BudgetRepository } from "../repositories/budget.repository.js";

type ExpenseInput = z.infer<typeof expenseSchema>;
type IncomeInput = z.infer<typeof incomeSchema>;
type TicketTierInput = z.infer<typeof ticketTierSchema>;
type ConsumableInput = z.infer<typeof consumableSchema>;

/**
 * Service métier pour le domaine budget.
 * Applique les contrôles de permissions avant de déléguer au {@link BudgetRepository}.
 */
export class BudgetService {
  constructor(private readonly budgetRepository: BudgetRepository) {}

  async listExpenses(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.read");
    return this.budgetRepository.listExpenses(eventId, workspaceId);
  }

  async createExpense(eventId: string, workspaceId: string, role: UserRole, userId: string, data: ExpenseInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.createExpense(eventId, workspaceId, userId, data);
  }

  async updateExpense(id: string, workspaceId: string, role: UserRole, userId: string, data: ExpenseInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.updateExpense(id, workspaceId, userId, data);
  }

  async deleteExpense(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "budget.write");
    return this.budgetRepository.deleteExpense(id, workspaceId, userId);
  }

  async listExpensePersons(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.read");
    return this.budgetRepository.listExpensePersons(eventId, workspaceId);
  }

  async listIncomes(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.read");
    return this.budgetRepository.listIncomes(eventId, workspaceId);
  }

  async createIncome(eventId: string, workspaceId: string, role: UserRole, userId: string, data: IncomeInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.createIncome(eventId, workspaceId, userId, data);
  }

  async updateIncome(id: string, workspaceId: string, role: UserRole, userId: string, data: IncomeInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.updateIncome(id, workspaceId, userId, data);
  }

  async deleteIncome(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "budget.write");
    return this.budgetRepository.deleteIncome(id, workspaceId, userId);
  }

  async listTicketTiers(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.read");
    return this.budgetRepository.listTicketTiers(eventId, workspaceId);
  }

  async createTicketTier(eventId: string, workspaceId: string, role: UserRole, data: TicketTierInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.createTicketTier(eventId, workspaceId, data);
  }

  async updateTicketTier(id: string, workspaceId: string, role: UserRole, data: TicketTierInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.updateTicketTier(id, workspaceId, data);
  }

  async deleteTicketTier(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.write");
    return this.budgetRepository.deleteTicketTier(id, workspaceId);
  }

  async syncShotgunTiers(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.write");
    return this.budgetRepository.syncShotgunTicketTiers(eventId, workspaceId);
  }

  async listConsumables(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.read");
    return this.budgetRepository.listConsumables(eventId, workspaceId);
  }

  async createConsumable(eventId: string, workspaceId: string, role: UserRole, data: ConsumableInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.createConsumable(eventId, workspaceId, data);
  }

  async updateConsumable(id: string, workspaceId: string, role: UserRole, data: ConsumableInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.updateConsumable(id, workspaceId, data);
  }

  async deleteConsumable(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.write");
    return this.budgetRepository.deleteConsumable(id, workspaceId);
  }
}
