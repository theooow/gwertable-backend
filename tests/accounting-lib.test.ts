import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  balanceSheet, buildOperations, encodeLatin9, fecRows, incomeStatement, positionsAt, toDay,
  type LedgerData, type LedgerExpense, type LedgerIncome, type Period,
} from "../src/lib/accounting.js";

const event = { id: "ev1", name: "Release", startsAt: new Date("2026-06-01T20:00:00Z"), vatMode: "ASSUJETTI" as const, defaultVatRateBasisPoints: 550 };
const nextYearEvent = { ...event, id: "ev2", name: "Next", startsAt: new Date("2027-02-01T20:00:00Z") };

function expense(overrides: Partial<LedgerExpense>): LedgerExpense {
  return {
    id: "x", eventId: "ev1", label: "Salle", category: "lieu", phase: "ACTUAL", amountCents: 12000, amountHtCents: 10000, amountTtcCents: 12000,
    paidAt: new Date("2026-05-20T10:00:00Z"), paidById: null, paidByName: null, reimbursement: "NOT_OWED", receiptUrl: "/r.pdf", ...overrides,
  };
}

function income(overrides: Partial<LedgerIncome>): LedgerIncome {
  return {
    id: "i", eventId: "ev1", label: "Bar", category: "bar", phase: "ACTUAL", amountCents: 6000, amountHtCents: 5000, amountTtcCents: 6000,
    receivedAt: new Date("2026-06-02T10:00:00Z"), receiptUrl: null, ...overrides,
  };
}

const data: LedgerData = {
  events: [event, nextYearEvent],
  expenses: [
    expense({ id: "venue" }),
    expense({ id: "advance", category: "boissons", label: "Bieres", paidById: "p1", paidByName: "Alice", reimbursement: "PENDING", receiptUrl: null }),
    expense({ id: "gift", category: "communication", label: "Flyers", paidById: "p2", paidByName: "Bob", reimbursement: "NOT_OWED" }),
    expense({ id: "unpaid", category: "matériel", label: "Sono", paidAt: null }),
    expense({ id: "deposit", eventId: "ev2", label: "Acompte salle", paidAt: new Date("2026-11-15T10:00:00Z") }),
    expense({ id: "forecast", phase: "FORECAST", label: "Imprevus" }),
  ],
  incomes: [
    income({ id: "bar" }),
    income({ id: "sponsor", category: "sponsor", label: "Sponsor", receivedAt: null }),
    income({ id: "presale", eventId: "ev2", label: "Prevente", receivedAt: new Date("2026-12-01T10:00:00Z") }),
  ],
  ticketTiers: [{ id: "t1", eventId: "ev1", name: "Early", organizerRevenueCents: 1055, sold: 100 }],
};

const period: Period = { startsOn: "2026-01-01", endsOn: "2026-12-31", framework: "ASSOCIATION", openingCashCents: 50000, closingBankBalanceCents: null };

describe("accounting engine", () => {
  const all = buildOperations(data, period.framework, ["ACTUAL"]);
  const current = all.filter((o) => o.date >= period.startsOn && o.date <= period.endsOn);

  it("classifies lines in the chart of accounts and splits VAT", () => {
    const venue = all.find((o) => o.sourceId === "venue")!;
    assert.equal(venue.account.number, "6132");
    assert.deepEqual([venue.htCents, venue.vatCents, venue.ttcCents], [10000, 2000, 12000]);
    assert.equal(all.find((o) => o.sourceId === "unpaid")!.account.number, "6135");
    assert.equal(all.find((o) => o.sourceId === "t1")!.htCents, Math.round(105500 * 10000 / 10550));
    assert.ok(!all.some((o) => o.sourceId === "forecast"));
  });

  it("uses Paris calendar days", () => {
    assert.equal(toDay(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
  });

  it("treats a renounced member advance as a donation in associations", () => {
    const statement = incomeStatement(current, "ASSOCIATION");
    const donations = statement.sections.find((s) => s.key === "donations")!;
    assert.equal(donations.totalCents, 12000);
    const company = buildOperations(data, "COMPANY", ["ACTUAL"]).find((o) => o.sourceId === "gift")!;
    assert.equal(company.counterpart, "PARTNER");
  });

  it("produces a balanced simplified balance sheet", () => {
    const statement = incomeStatement(current, "ASSOCIATION");
    assert.equal(statement.resultCents, statement.totalProductsCents - statement.totalChargesCents);
    const sheet = balanceSheet(all, period, statement);
    assert.ok(sheet.balanced, JSON.stringify(sheet));
    const value = (key: string) => [...sheet.assets, ...sheet.liabilities].find((l) => l.key === key)!.amountCents;
    assert.equal(value("members"), 12000);
    assert.equal(value("suppliers"), 12000);
    assert.equal(value("receivables"), 6000);
    assert.equal(value("prepaidCharges"), 12000);
    assert.equal(value("deferredIncome"), 6000);
    assert.equal(sheet.computedCashCents, 50000 - 12000 - 12000 + 6000 + 105500 + 6000);
  });

  it("stays balanced for a company with a negative cash position and an opening position", () => {
    const companyPeriod: Period = { ...period, startsOn: "2027-01-01", endsOn: "2027-12-31", framework: "COMPANY", openingCashCents: -1000, closingBankBalanceCents: 0 };
    const ops = buildOperations(data, "COMPANY", ["ACTUAL"]);
    const statement = incomeStatement(ops.filter((o) => o.date >= companyPeriod.startsOn), "COMPANY");
    const sheet = balanceSheet(ops, companyPeriod, statement);
    assert.ok(sheet.balanced, JSON.stringify(sheet));
    assert.equal(positionsAt(ops, "2026-12-31").prepaidChargesCents, 12000);
    assert.equal(sheet.bankGapCents, -sheet.computedCashCents);
  });

  it("exports balanced FEC entries with the regulatory columns", () => {
    const rows = fecRows(all, period, "2027-01-15");
    assert.equal(rows[0].split("|").length, 18);
    const totals = new Map<string, number>();
    for (const row of rows.slice(1)) {
      const columns = row.split("|");
      assert.equal(columns.length, 18);
      const cents = (value: string) => Math.round(Number(value.replace(",", ".")) * 100);
      totals.set(columns[2], (totals.get(columns[2]) ?? 0) + cents(columns[11]) - cents(columns[12]));
    }
    assert.ok([...totals.values()].every((total) => total === 0), JSON.stringify([...totals]));
    assert.ok(rows.some((row) => row.startsWith("AN|")));
    assert.ok(rows.every((row, index) => index === 0 || row.split("|")[15] === "20270115"));
  });

  it("encodes FEC text as ISO 8859-15", () => {
    assert.deepEqual([...encodeLatin9("é€Œ☃")], [0xe9, 0xa4, 0xbc, 0x3f]);
  });
});
