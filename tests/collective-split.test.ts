import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ProfitSplitMode, ReimbStatus } from "@prisma/client";
import { collectivePayouts } from "../src/lib/collective-split.js";

type SplitCase = {
  name: string;
  collectives: { id: string; shareBasisPoints: number; personIds: string[] }[];
  expenses: { paidById: string | null; amountCents: number; reimbursement: ReimbStatus }[];
  resultCents: number;
  mode: ProfitSplitMode;
  stakesFirst: boolean;
  payouts: number[];
  pending: number[];
};

// Same file as lib/collective-split-cases.json in the frontend: both implementations must give these results.
const cases = JSON.parse(readFileSync("tests/fixtures/collective-split-cases.json", "utf8")) as SplitCase[];

for (const splitCase of cases) {
  test(`collective split matches the frontend: ${splitCase.name}`, () => {
    const payouts = collectivePayouts(
      splitCase.collectives.map((collective) => ({ ...collective, name: collective.id })),
      splitCase.expenses,
      splitCase.resultCents,
      splitCase.mode,
      splitCase.stakesFirst,
    );
    assert.deepEqual(payouts.map((payout) => payout.payoutCents), splitCase.payouts);
    assert.deepEqual(payouts.map((payout) => payout.pendingCents), splitCase.pending);
  });
}
