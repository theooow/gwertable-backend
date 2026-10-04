import type { BudgetPhase, ReimbStatus } from "@prisma/client";

/** An artist fee stays forecast until it has actually been paid. */
export function artistFeePhase(reimbursement: ReimbStatus): BudgetPhase {
  return reimbursement === "PENDING" ? "FORECAST" : "ACTUAL";
}
