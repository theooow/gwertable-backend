import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

const issuer = {
  legalName: "Association Gwertable", legalForm: "Association loi 1901", address: "1 rue de la Fête", postalCode: "75011",
  city: "Paris", country: "France", representative: "Alice Martin", representativeRole: "Présidente", email: "contact@abregi.test",
};
const fiscalYear = { label: "Exercice 2026", startsOn: "2026-01-01", endsOn: "2026-09-30", framework: "ASSOCIATION", openingCashCents: 100000, closingBankBalanceCents: null };

type Report = {
  source: string;
  kpis: { productsCents: number; chargesCents: number; resultCents: number; cashCents: number; eventsCount: number };
  balanceSheet: { balanced: boolean; computedCashCents: number };
  incomeStatement: { sections: { key: string; lines: { account: string; amountCents: number }[] }[] };
  checks: { code: string; severity: string }[];
  liveMatchesSnapshot: boolean | null;
  integrityVerified?: boolean;
};

async function seed() {
  const { authorization } = await seedAdminSession();
  const { event } = await seedEventContext(authorization);
  const base = `/api/events/${event.id}`;
  await request("POST", `${base}/expenses`, authorization, { label: "Salle", amount: "500", category: "lieu", reimbursement: "NOT_OWED", paidAt: "2026-05-20", receiptUrl: "/api/uploads/receipts/salle.pdf" });
  await request("POST", `${base}/expenses`, authorization, { label: "Imprevus", amount: "200", category: "autre", phase: "FORECAST" });
  await request("POST", `${base}/incomes`, authorization, { label: "Bar", amount: "800", category: "bar", receivedAt: "2026-06-02" });
  const created = await request("POST", "/api/accounting/fiscal-years", authorization, fiscalYear);
  assert.equal(created.statusCode, 201, created.body);
  return { authorization, base, fiscalYear: json<{ id: string }>(created) };
}

describe("accounting", () => {
  it("builds the statements of a fiscal year from actual budget lines", async () => {
    const { authorization, fiscalYear: { id } } = await seed();
    const response = await request("GET", `/api/accounting/fiscal-years/${id}/report`, authorization);
    assert.equal(response.statusCode, 200, response.body);
    const report = json<Report>(response);
    assert.equal(report.source, "LIVE");
    assert.deepEqual([report.kpis.productsCents, report.kpis.chargesCents, report.kpis.resultCents, report.kpis.eventsCount], [80000, 50000, 30000, 1]);
    assert.equal(report.kpis.cashCents, 130000);
    assert.ok(report.balanceSheet.balanced);
    assert.equal(report.incomeStatement.sections.find((s) => s.key === "external")!.lines[0].account, "6132");
    const codes = report.checks.map((c) => c.code);
    assert.ok(codes.includes("BANK_BALANCE_MISSING") && codes.includes("ISSUER_INCOMPLETE") && codes.includes("FORECAST_LEFTOVERS"));
  });

  it("rejects overlapping and inconsistent periods", async () => {
    const { authorization } = await seed();
    assert.equal((await request("POST", "/api/accounting/fiscal-years", authorization, { ...fiscalYear, label: "Bis", startsOn: "2026-09-01", endsOn: "2027-08-31" })).statusCode, 409);
    assert.equal((await request("POST", "/api/accounting/fiscal-years", authorization, { ...fiscalYear, startsOn: "2027-12-31", endsOn: "2027-01-01" })).statusCode, 400);
  });

  it("exports a FEC file", async () => {
    const { authorization, fiscalYear: { id } } = await seed();
    const response = await request("GET", `/api/accounting/fiscal-years/${id}/fec`, authorization);
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-disposition"]), /000000000FEC20260930\.txt/);
    const rows = response.body.trim().split("\r\n");
    assert.ok(rows[0].startsWith("JournalCode|JournalLib|EcritureNum"));
    assert.ok(rows.some((row) => row.startsWith("AC|") && row.includes("|6132|")));
  });

  it("closes a reconciled fiscal year and freezes its statements", async () => {
    const { authorization, base, fiscalYear: { id } } = await seed();
    const close = () => request("POST", `/api/accounting/fiscal-years/${id}/close`, authorization);
    assert.equal((await close()).statusCode, 409);
    await request("PUT", "/api/workspace/contract-issuer", authorization, issuer);
    await prisma.expense.deleteMany({ where: { phase: "FORECAST" } });
    assert.equal((await request("PUT", `/api/accounting/fiscal-years/${id}`, authorization, { ...fiscalYear, closingBankBalanceCents: 130000 })).statusCode, 200);
    const closed = await close();
    assert.equal(closed.statusCode, 200, closed.body);
    assert.match(closed.json().closedHash, /^[0-9a-f]{64}$/);
    assert.equal((await request("PUT", `/api/accounting/fiscal-years/${id}`, authorization, fiscalYear)).statusCode, 409);
    assert.equal((await request("DELETE", `/api/accounting/fiscal-years/${id}`, authorization)).statusCode, 409);

    await request("POST", `${base}/incomes`, authorization, { label: "Merch tardif", amount: "50", category: "merch", receivedAt: "2026-06-02" });
    const report = json<Report>(await request("GET", `/api/accounting/fiscal-years/${id}/report`, authorization));
    assert.equal(report.source, "SNAPSHOT");
    assert.equal(report.integrityVerified, true);
    assert.equal(report.kpis.productsCents, 80000);
    assert.equal(report.liveMatchesSnapshot, false);
  });

  it("restricts accounting to finance roles", async () => {
    const { authorization, fiscalYear: { id } } = await seed();
    await prisma.workspaceMember.updateMany({ data: { role: "VOLUNTEER" } });
    await prisma.user.updateMany({ data: { role: "VOLUNTEER" } });
    assert.equal((await request("GET", `/api/accounting/fiscal-years/${id}/report`, authorization)).statusCode, 403);
  });
});
