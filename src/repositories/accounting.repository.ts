import type { FiscalYear, Prisma, PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import type { LedgerData } from "../lib/accounting.js";
import type { FiscalYearInput } from "../schemas/fiscal-year.js";

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

export class AccountingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  listFiscalYears(workspaceId: string) {
    return this.prisma.fiscalYear.findMany({ where: { workspaceId }, orderBy: { startsOn: "desc" }, omit: { closedSnapshot: true } });
  }

  async getFiscalYear(id: string, workspaceId: string): Promise<FiscalYear> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({ where: { id, workspaceId } });
    if (!fiscalYear) throw new NotFoundError("Exercice introuvable");
    return fiscalYear;
  }

  private async assertNoOverlap(workspaceId: string, data: FiscalYearInput, excludeId?: string) {
    const overlapping = await this.prisma.fiscalYear.findFirst({
      where: { workspaceId, id: excludeId ? { not: excludeId } : undefined, startsOn: { lte: asDate(data.endsOn) }, endsOn: { gte: asDate(data.startsOn) } },
      select: { label: true },
    });
    if (overlapping) throw new ConflictError(`Les dates chevauchent l'exercice « ${overlapping.label} »`);
  }

  private fields(data: FiscalYearInput) {
    return { ...data, startsOn: asDate(data.startsOn), endsOn: asDate(data.endsOn) };
  }

  async createFiscalYear(workspaceId: string, data: FiscalYearInput) {
    await this.assertNoOverlap(workspaceId, data);
    return this.prisma.fiscalYear.create({ data: { workspaceId, ...this.fields(data) }, omit: { closedSnapshot: true } });
  }

  async updateFiscalYear(id: string, workspaceId: string, data: FiscalYearInput) {
    await this.assertNoOverlap(workspaceId, data, id);
    return this.prisma.fiscalYear.update({ where: { id }, data: this.fields(data), omit: { closedSnapshot: true } });
  }

  deleteFiscalYear(id: string) {
    return this.prisma.fiscalYear.delete({ where: { id } });
  }

  closeFiscalYear(id: string, userId: string, snapshot: Prisma.InputJsonValue, hash: string) {
    return this.prisma.fiscalYear.update({
      where: { id, closedAt: null },
      data: { closedAt: new Date(), closedById: userId, closedSnapshot: snapshot, closedHash: hash },
      omit: { closedSnapshot: true },
    });
  }

  findFiscalYearCovering(workspaceId: string, date: Date) {
    const day = asDate(date.toISOString().slice(0, 10));
    return this.prisma.fiscalYear.findFirst({ where: { workspaceId, startsOn: { lte: day }, endsOn: { gte: day } }, select: { id: true, label: true, framework: true } });
  }

  async getIssuer(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, contractIssuer: true } });
    return workspace;
  }

  /** Every budget line of the workspace: positions depend on previous periods. */
  async loadLedger(workspaceId: string, eventId?: string): Promise<LedgerData> {
    const eventWhere = { workspaceId, ...(eventId ? { id: eventId } : {}) };
    const [events, expenses, incomes, ticketTiers] = await Promise.all([
      this.prisma.event.findMany({ where: eventWhere, select: { id: true, name: true, startsAt: true, vatMode: true, defaultVatRateBasisPoints: true } }),
      this.prisma.expense.findMany({
        where: { event: eventWhere },
        select: {
          id: true, eventId: true, label: true, category: true, phase: true, amountCents: true, amountHtCents: true, amountTtcCents: true,
          paidAt: true, paidById: true, reimbursement: true, receiptUrl: true, paidBy: { select: { fullName: true } },
        },
      }),
      this.prisma.income.findMany({
        where: { event: eventWhere },
        select: { id: true, eventId: true, label: true, category: true, phase: true, amountCents: true, amountHtCents: true, amountTtcCents: true, receivedAt: true, receiptUrl: true },
      }),
      this.prisma.ticketTier.findMany({ where: { event: eventWhere }, select: { id: true, eventId: true, name: true, organizerRevenueCents: true, sold: true } }),
    ]);
    return {
      events,
      expenses: expenses.map(({ paidBy, ...expense }) => ({ ...expense, paidByName: paidBy?.fullName ?? null })),
      incomes,
      ticketTiers,
    };
  }
}
