import type { ProfitSplitMode, ReimbStatus } from "@prisma/client";

/**
 * Splits an event result between its co-organising collectives.
 * Mirrors `splitResultBetweenCollectives` in the frontend (lib/collectives.ts): keep both in sync.
 */

export type SplitCollective = { id: string; name: string; shareBasisPoints: number; personIds: string[] };
export type SplitExpense = { paidById: string | null; amountCents: number; reimbursement: ReimbStatus };
export type CollectivePayout = { id: string; name: string; pendingCents: number; payoutCents: number };

/** Splits an amount by weights; the last part absorbs rounding so parts always sum to the amount. */
function allocate(amountCents: number, weights: number[]) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let distributed = 0;
  return weights.map((weight, index) => {
    const part = index === weights.length - 1 ? amountCents - distributed : Math.round((amountCents * weight) / (totalWeight || 1));
    distributed += part;
    return part;
  });
}

/** What each collective gets back (negative: pays in), its members' pending reimbursements included. */
export function collectivePayouts(
  collectives: SplitCollective[],
  expenses: SplitExpense[],
  resultCents: number,
  mode: ProfitSplitMode,
  stakesFirst: boolean,
): CollectivePayout[] {
  const collectiveByPerson = new Map(collectives.flatMap((collective) => collective.personIds.map((personId) => [personId, collective.id] as const)));
  const contributions = new Map<string, { total: number; pending: number }>();
  let outsideGiftCents = 0;
  for (const expense of expenses) {
    if (!expense.paidById || expense.reimbursement === "DONE") continue;
    const collectiveId = collectiveByPerson.get(expense.paidById);
    if (!collectiveId) {
      if (expense.reimbursement === "NOT_OWED") outsideGiftCents += expense.amountCents;
      continue;
    }
    const entry = contributions.get(collectiveId) ?? { total: 0, pending: 0 };
    entry.total += expense.amountCents;
    if (expense.reimbursement === "PENDING") entry.pending += expense.amountCents;
    contributions.set(collectiveId, entry);
  }

  const rawWeights = collectives.map((collective) => {
    if (mode === "PRO_RATA_INVESTMENT") return contributions.get(collective.id)?.total ?? 0;
    if (mode === "CUSTOM") return collective.shareBasisPoints;
    return 1;
  });
  const weights = rawWeights.some((weight) => weight > 0) ? rawWeights : collectives.map(() => 1);
  const pending = collectives.map((collective) => contributions.get(collective.id)?.pending ?? 0);
  const stakes = collectives.map((collective) => contributions.get(collective.id)?.total ?? 0);
  const totalStakes = stakes.reduce((sum, stake) => sum + stake, 0);
  // Gifts never left the cash box, so they add to what it holds.
  const cashForStakes = resultCents + totalStakes + outsideGiftCents;
  const repaidStakes = Math.min(cashForStakes, totalStakes);
  const payouts = !(stakesFirst && resultCents < 0)
    ? allocate(resultCents, weights).map((share, index) => share + pending[index]!)
    : cashForStakes >= 0
      ? allocate(repaidStakes, stakes).map((repaid, index) => repaid + allocate(cashForStakes - repaidStakes, weights)[index]!)
      : allocate(cashForStakes, weights);

  return collectives.map((collective, index) => ({ id: collective.id, name: collective.name, pendingCents: pending[index]!, payoutCents: payouts[index]! }));
}
