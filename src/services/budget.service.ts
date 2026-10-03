import type { ExpenseCellInput, IncomeCellInput } from "../schemas/budget-cell.js";
import type { UsagePlan, UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import { requirePlanFeature } from "../lib/usage-plans.js";
import type { z } from "zod";
import type { BudgetImportPreviewInput } from "../schemas/budget-import.js";
import { EXPENSE_CATEGORIES, type expenseSchema } from "../schemas/expense.js";
import { INCOME_CATEGORIES, type incomeSchema } from "../schemas/income.js";
import { previewBudgetDocument, type BudgetDocumentKind } from "./document-extraction.service.js";
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

  async updateExpenseCell(id: string, workspaceId: string, role: UserRole, userId: string, data: ExpenseCellInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.updateExpenseCell(id, workspaceId, userId, data);
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

  async previewDocumentImport(kind: BudgetDocumentKind, role: UserRole, usagePlan: UsagePlan, data: BudgetImportPreviewInput) {
    requireCan(role, "budget.write");
    requirePlanFeature(usagePlan, "ai.documentImport");
    return previewBudgetDocument(kind, kind === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES, {
      fileName: data.fileName,
      contentType: data.contentType,
      dataBase64: data.data,
    });
  }

  async importExpenses(eventId: string, workspaceId: string, role: UserRole, userId: string, lines: ExpenseInput[]) {
    requireCan(role, "budget.write");
    const expenses = [];
    for (const line of lines) {
      expenses.push(await this.budgetRepository.createExpense(eventId, workspaceId, userId, line));
    }
    return expenses;
  }

  async importIncomes(eventId: string, workspaceId: string, role: UserRole, userId: string, lines: IncomeInput[]) {
    requireCan(role, "budget.write");
    const incomes = [];
    for (const line of lines) {
      incomes.push(await this.budgetRepository.createIncome(eventId, workspaceId, userId, line));
    }
    return incomes;
  }

  async listIncomes(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.read");
    return this.budgetRepository.listIncomes(eventId, workspaceId);
  }

  async createIncome(eventId: string, workspaceId: string, role: UserRole, userId: string, data: IncomeInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.createIncome(eventId, workspaceId, userId, data);
  }

  async updateIncomeCell(id: string, workspaceId: string, role: UserRole, userId: string, data: IncomeCellInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.updateIncomeCell(id, workspaceId, userId, data);
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

  async createTicketTier(eventId: string, workspaceId: string, role: UserRole, userId: string, data: TicketTierInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.createTicketTier(eventId, workspaceId, userId, data);
  }

  async updateTicketTier(id: string, workspaceId: string, role: UserRole, userId: string, data: TicketTierInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.updateTicketTier(id, workspaceId, userId, data);
  }

  async deleteTicketTier(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "budget.write");
    return this.budgetRepository.deleteTicketTier(id, workspaceId, userId);
  }

  async syncShotgunTiers(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.write");
    return this.budgetRepository.syncShotgunTicketTiers(eventId, workspaceId);
  }

  async listConsumables(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "budget.read");
    return this.budgetRepository.listConsumables(eventId, workspaceId);
  }

  async createConsumable(eventId: string, workspaceId: string, role: UserRole, userId: string, data: ConsumableInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.createConsumable(eventId, workspaceId, userId, data);
  }

  async updateConsumable(id: string, workspaceId: string, role: UserRole, userId: string, data: ConsumableInput) {
    requireCan(role, "budget.write");
    return this.budgetRepository.updateConsumable(id, workspaceId, userId, data);
  }

  async deleteConsumable(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "budget.write");
    return this.budgetRepository.deleteConsumable(id, workspaceId, userId);
  }
}
