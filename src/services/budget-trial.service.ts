import type { UserRole } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors.js";
import type { BudgetLeadRepository } from "../repositories/budget-lead.repository.js";
import { budgetTrialSchema, type BudgetTrial } from "../schemas/budget-trial.js";
import { expenseSchema } from "../schemas/expense.js";
import { eventSchema } from "../schemas/event.js";
import type { BudgetService } from "./budget.service.js";
import type { EventService } from "./event.service.js";

const DAY_MS = 86400000;

const euros = (cents: number) => (cents / 100).toFixed(2);

export class BudgetTrialService {
  constructor(
    private readonly leads: BudgetLeadRepository,
    private readonly events: EventService,
    private readonly budget: BudgetService,
  ) {}

  startTrial(email: string, anonymousId?: string) {
    return this.leads.create(email, anonymousId);
  }

  async getTrial(token: string) {
    const lead = await this.findLead(token);
    const trial = budgetTrialSchema.safeParse(lead.trial);
    return { email: lead.email, trial: trial.success ? trial.data : null, convertedEventId: lead.convertedEventId };
  }

  async saveTrial(token: string, trial: BudgetTrial) {
    const lead = await this.findLead(token);
    if (lead.convertedAt) throw new ConflictError("Cet essai a déjà été transformé en événement");
    await this.leads.saveTrial(lead.id, trial, !lead.trialCompletedAt);
  }

  async unsubscribe(token: string) {
    const lead = await this.findLead(token);
    await this.leads.unsubscribe(lead.email);
  }

  /** Turns the trial into the user's first event with a forecast budget, so they land on a filled budget. */
  async claim(token: string, workspaceId: string, role: UserRole, userId: string) {
    const lead = await this.findLead(token);
    if (lead.convertedEventId) return { eventId: lead.convertedEventId };
    const parsed = budgetTrialSchema.safeParse(lead.trial);
    if (!parsed.success) throw new ValidationError("Cet essai ne contient pas encore de budget");
    const trial = parsed.data;

    const startsAt = trial.eventDate ? new Date(`${trial.eventDate}T20:00:00.000Z`) : new Date(Date.now() + 30 * DAY_MS);
    const event = await this.events.create(workspaceId, role, userId, eventSchema.parse({
      name: trial.eventName || "Mon premier événement",
      startsAt: startsAt.toISOString(),
      status: "PLANNING",
      avgBasketCents: trial.barSpendPerPersonCents,
    }));
    await this.budget.createTicketTier(event.id, workspaceId, role, userId, {
      name: "Plein tarif", publicPriceCents: trial.ticketPriceCents, organizerRevenueCents: trial.ticketPriceCents, quantity: trial.capacity,
    });
    const expenses: [string, string, number][] = [["Salle", "lieu", trial.venueCents], ["Artistes", "artistes", trial.artistsCents], ["Technique & communication", "son", trial.techCommsCents]];
    for (const [label, category, amountCents] of expenses) {
      if (amountCents === 0) continue;
      await this.budget.createExpense(event.id, workspaceId, role, userId, expenseSchema.parse({
        label, category, amount: euros(amountCents), phase: "FORECAST", reimbursement: "NOT_OWED",
      }));
    }
    await this.leads.markConverted(lead.id, userId, event.id);
    return { eventId: event.id };
  }

  private async findLead(token: string) {
    const lead = await this.leads.findByToken(token);
    if (!lead) throw new NotFoundError("Essai introuvable");
    return lead;
  }
}
