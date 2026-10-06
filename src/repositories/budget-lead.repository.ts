import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { BudgetTrial } from "../schemas/budget-trial.js";

export class BudgetLeadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(email: string, anonymousId?: string) {
    return this.prisma.budgetLead.create({
      data: { email, anonymousId, token: crypto.randomBytes(24).toString("base64url") },
      select: { token: true },
    });
  }

  findByToken(token: string) {
    return this.prisma.budgetLead.findUnique({ where: { token } });
  }

  saveTrial(id: string, trial: BudgetTrial, firstCompletion: boolean) {
    return this.prisma.budgetLead.update({
      where: { id },
      data: { trial, ...(firstCompletion ? { trialCompletedAt: new Date() } : {}) },
    });
  }

  /** Unsubscribing is per person, so every trial left with the same email stops being reminded. */
  unsubscribe(email: string) {
    return this.prisma.budgetLead.updateMany({ where: { email, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
  }

  markConverted(id: string, userId: string, eventId: string) {
    return this.prisma.budgetLead.update({
      where: { id },
      data: { convertedAt: new Date(), convertedUserId: userId, convertedEventId: eventId },
    });
  }
}
