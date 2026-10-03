import crypto from "node:crypto";
import type { FiscalYear, Prisma, UserRole } from "@prisma/client";
import {
  balanceSheet, buildOperations, cashFlowCents, encodeLatin9, fecRows, inPeriod, incomeStatement, positionsAt, toDay, vatSummary,
  type BalanceSheet, type IncomeStatement, type LedgerData, type Operation, type Period, type Vat,
} from "../lib/accounting.js";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors.js";
import { requireCan } from "../lib/permissions.js";
import { contractIssuerSchema } from "../schemas/contract-issuer.js";
import type { FiscalYearInput } from "../schemas/fiscal-year.js";
import type { AccountingRepository } from "../repositories/accounting.repository.js";

export type CheckSeverity = "error" | "warning" | "info";
export type AccountingCheck = { code: string; severity: CheckSeverity; message: string; count?: number; amountCents?: number };

type Issuer = { name: string; legalName: string; legalForm: string; siret: string; rna: string; address: string; postalCode: string; city: string; country: string };

export type AccountingReport = {
  fiscalYear: { id: string; label: string; startsOn: string; endsOn: string; framework: FiscalYear["framework"]; closedAt: string | null; closedHash: string | null };
  issuer: Issuer;
  generatedAt: string;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  vat: Vat;
  kpis: {
    productsCents: number;
    chargesCents: number;
    resultCents: number;
    marginBasisPoints: number | null;
    cashCents: number;
    eventsCount: number;
    ticketsSold: number;
    receiptCoverageBasisPoints: number | null;
  };
  events: { id: string; name: string; date: string; productsCents: number; chargesCents: number; resultCents: number; projectedResultCents: number }[];
  monthly: { month: string; productsCents: number; chargesCents: number; cashInCents: number; cashOutCents: number; cashEndCents: number }[];
  checks: AccountingCheck[];
  assumptions: string[];
};

type Snapshot = { report: AccountingReport; fec: string[] };

const day = (date: Date) => date.toISOString().slice(0, 10);

/** JSON with sorted keys, so that a hash survives a JSONB round-trip. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(snapshot: Snapshot) {
  return crypto.createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

function period(fiscalYear: FiscalYear): Period {
  return {
    startsOn: day(fiscalYear.startsOn),
    endsOn: day(fiscalYear.endsOn),
    framework: fiscalYear.framework,
    openingCashCents: fiscalYear.openingCashCents,
    closingBankBalanceCents: fiscalYear.closingBankBalanceCents,
  };
}

function monthsOf({ startsOn, endsOn }: Period) {
  const months: string[] = [];
  for (let cursor = startsOn.slice(0, 7); cursor <= endsOn.slice(0, 7);) {
    months.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  }
  return months;
}

function signedHt(operation: Operation) {
  return operation.kind === "income" ? operation.htCents : -operation.htCents;
}

function assumptions(framework: FiscalYear["framework"]): string[] {
  return [
    "Les produits et les charges sont rattachés à l'exercice de la date de l'événement (principe d'indépendance des exercices).",
    "Seules les lignes « Réel » sont comptabilisées ; les lignes prévisionnelles n'apparaissent que dans les projections.",
    "La billetterie est comptabilisée pour la recette nette organisateur des billets vendus, réputée encaissée le jour de l'événement.",
    "La TVA est ventilée uniquement pour les événements assujettis ; la TVA des exercices antérieurs est réputée réglée.",
    framework === "ASSOCIATION"
      ? "Une avance d'un membre non remboursée (« non dû ») est traitée comme un abandon de frais (compte 7541)."
      : "Une avance d'un associé non remboursée (« non dû ») est portée en compte courant d'associé (compte 455).",
    "La trésorerie est reconstituée à partir du solde d'ouverture et des dates de paiement et d'encaissement saisies.",
    "Immobilisations, amortissements, stocks, provisions, charges sociales et impôt sur les bénéfices ne sont pas gérés : ils doivent être ajoutés par l'expert-comptable.",
  ];
}

export class AccountingService {
  constructor(private readonly repository: AccountingRepository) {}

  listFiscalYears(workspaceId: string, role: UserRole) {
    requireCan(role, "finance.read");
    return this.repository.listFiscalYears(workspaceId);
  }

  private validate(data: FiscalYearInput) {
    if (data.endsOn <= data.startsOn) throw new ValidationError("La date de clôture doit suivre la date d'ouverture");
    const months = (Number(data.endsOn.slice(0, 4)) - Number(data.startsOn.slice(0, 4))) * 12 + Number(data.endsOn.slice(5, 7)) - Number(data.startsOn.slice(5, 7));
    if (months >= 24) throw new ValidationError("Un exercice ne peut pas dépasser 24 mois");
  }

  createFiscalYear(workspaceId: string, role: UserRole, data: FiscalYearInput) {
    requireCan(role, "finance.write");
    this.validate(data);
    return this.repository.createFiscalYear(workspaceId, data);
  }

  private async getOpenFiscalYear(id: string, workspaceId: string) {
    const fiscalYear = await this.repository.getFiscalYear(id, workspaceId);
    if (fiscalYear.closedAt) throw new ConflictError("L'exercice est clôturé et ne peut plus être modifié");
    return fiscalYear;
  }

  async updateFiscalYear(id: string, workspaceId: string, role: UserRole, data: FiscalYearInput) {
    requireCan(role, "finance.write");
    this.validate(data);
    await this.getOpenFiscalYear(id, workspaceId);
    return this.repository.updateFiscalYear(id, workspaceId, data);
  }

  async deleteFiscalYear(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "finance.write");
    await this.getOpenFiscalYear(id, workspaceId);
    await this.repository.deleteFiscalYear(id);
  }

  private async issuer(workspaceId: string): Promise<Issuer> {
    const workspace = await this.repository.getIssuer(workspaceId);
    const parsed = contractIssuerSchema.safeParse(workspace.contractIssuer ?? {});
    const issuer = parsed.success ? parsed.data : contractIssuerSchema.parse({});
    return {
      name: workspace.name, legalName: issuer.legalName, legalForm: issuer.legalForm, siret: issuer.siret, rna: issuer.rna,
      address: issuer.address, postalCode: issuer.postalCode, city: issuer.city, country: issuer.country,
    };
  }

  private checks(fiscalYear: FiscalYear, current: Operation[], sheet: BalanceSheet, forecast: Operation[], issuer: Issuer): AccountingCheck[] {
    const checks: AccountingCheck[] = [];
    const add = (check: AccountingCheck) => { if (check.count !== 0) checks.push(check); };
    const sum = (operations: Operation[]) => operations.reduce((total, operation) => total + operation.ttcCents, 0);
    const today = toDay(new Date());
    const p = period(fiscalYear);
    const liability = (key: string) => sheet.liabilities.find((line) => line.key === key)?.amountCents ?? 0;

    const missingReceipts = current.filter((o) => o.kind === "expense" && !o.hasReceipt);
    add({ code: "RECEIPTS_MISSING", severity: "error", count: missingReceipts.length, amountCents: sum(missingReceipts), message: "Dépenses sans pièce justificative : toute écriture doit s'appuyer sur un justificatif conservé 10 ans." });
    const incomesWithoutReceipt = current.filter((o) => o.kind === "income" && !o.hasReceipt);
    add({ code: "INCOME_RECEIPTS_MISSING", severity: "warning", count: incomesWithoutReceipt.length, amountCents: sum(incomesWithoutReceipt), message: "Recettes sans justificatif (ticket Z de caisse, relevé de vente, facture, convention de partenariat)." });
    if (!sheet.balanced) add({ code: "UNBALANCED", severity: "error", message: "Le bilan n'est pas équilibré." });
    if (p.endsOn >= today) add({ code: "PERIOD_NOT_ENDED", severity: "info", message: "L'exercice n'est pas terminé : les états sont provisoires." });
    if (sheet.declaredBankBalanceCents === null) {
      add({ code: "BANK_BALANCE_MISSING", severity: "error", message: "Saisissez le solde bancaire au jour de la clôture pour rapprocher la trésorerie." });
    } else if (sheet.bankGapCents !== 0) {
      add({ code: "BANK_GAP", severity: "error", amountCents: sheet.bankGapCents ?? 0, message: "Écart entre la trésorerie calculée et le solde bancaire déclaré : des paiements ou encaissements manquent ou sont mal datés." });
    }
    if (liability("members") > 0) add({ code: "REIMBURSEMENTS_PENDING", severity: "warning", amountCents: liability("members"), message: "Avances de membres restant à rembourser à la clôture." });
    if (liability("suppliers") > 0) add({ code: "UNPAID_EXPENSES", severity: "warning", amountCents: liability("suppliers"), message: "Dépenses sans date de paiement, portées en dettes fournisseurs." });
    const receivables = sheet.assets.find((line) => line.key === "receivables")?.amountCents ?? 0;
    if (receivables > 0) add({ code: "UNRECEIVED_INCOMES", severity: "warning", amountCents: receivables, message: "Recettes sans date d'encaissement, portées en créances." });
    const leftovers = forecast.filter((o) => inPeriod(o.date, p) && o.date < today);
    add({ code: "FORECAST_LEFTOVERS", severity: "warning", count: leftovers.length, amountCents: sum(leftovers), message: "Lignes prévisionnelles restantes sur des événements passés : convertissez-les en réel ou supprimez-les." });
    const missingIdentity = [!issuer.legalName && "nom légal", !issuer.address && "adresse", fiscalYear.framework === "COMPANY" && !issuer.siret && "SIRET"].filter(Boolean);
    if (missingIdentity.length > 0) add({ code: "ISSUER_INCOMPLETE", severity: "error", message: `Identité de la structure incomplète (${missingIdentity.join(", ")}) : complétez-la dans les paramètres de l'espace.` });
    if (!current.length) add({ code: "NO_OPERATIONS", severity: "info", message: "Aucune opération réelle sur cet exercice." });
    return checks;
  }

  private buildReport(fiscalYear: FiscalYear, ledger: LedgerData, issuer: Issuer) {
    const p = period(fiscalYear);
    const all = buildOperations(ledger, p.framework, ["ACTUAL"]);
    const forecast = buildOperations(ledger, p.framework, ["FORECAST"]);
    const current = all.filter((o) => inPeriod(o.date, p));
    const statement = incomeStatement(current, p.framework);
    const sheet = balanceSheet(all, p, statement);
    const expenses = current.filter((o) => o.kind === "expense");
    const eventIds = new Set(current.map((o) => o.eventId));
    for (const event of ledger.events) if (inPeriod(toDay(event.startsAt), p)) eventIds.add(event.id);

    const events = ledger.events.filter((event) => eventIds.has(event.id)).map((event) => {
      const own = current.filter((o) => o.eventId === event.id);
      const result = incomeStatement(own, p.framework);
      const projected = result.resultCents + forecast.filter((o) => o.eventId === event.id).reduce((total, o) => total + signedHt(o), 0);
      return { id: event.id, name: event.name, date: toDay(event.startsAt), productsCents: result.totalProductsCents, chargesCents: result.totalChargesCents, resultCents: result.resultCents, projectedResultCents: projected };
    }).sort((a, b) => a.date.localeCompare(b.date));

    let cash = p.openingCashCents;
    const monthly = monthsOf(p).map((month) => {
      const own = current.filter((o) => o.date.startsWith(month));
      const settled = all.filter((o) => o.settledOn?.startsWith(month) && inPeriod(o.settledOn, p));
      const cashInCents = settled.filter((o) => o.kind === "income").reduce((total, o) => total + o.ttcCents, 0);
      const cashOutCents = settled.filter((o) => o.kind === "expense").reduce((total, o) => total + o.ttcCents, 0);
      cash += cashInCents - cashOutCents;
      return {
        month,
        productsCents: own.filter((o) => o.kind === "income").reduce((total, o) => total + o.htCents, 0),
        chargesCents: own.filter((o) => o.kind === "expense").reduce((total, o) => total + o.htCents, 0),
        cashInCents,
        cashOutCents,
        cashEndCents: cash,
      };
    });

    const report: AccountingReport = {
      fiscalYear: {
        id: fiscalYear.id, label: fiscalYear.label, startsOn: p.startsOn, endsOn: p.endsOn, framework: p.framework,
        closedAt: fiscalYear.closedAt?.toISOString() ?? null, closedHash: fiscalYear.closedHash,
      },
      issuer,
      generatedAt: new Date().toISOString(),
      incomeStatement: statement,
      balanceSheet: sheet,
      vat: vatSummary(current),
      kpis: {
        productsCents: statement.totalProductsCents,
        chargesCents: statement.totalChargesCents,
        resultCents: statement.resultCents,
        marginBasisPoints: statement.totalProductsCents > 0 ? Math.round((statement.resultCents * 10000) / statement.totalProductsCents) : null,
        cashCents: p.openingCashCents + cashFlowCents(all, p),
        eventsCount: events.length,
        ticketsSold: ledger.ticketTiers.filter((tier) => current.some((o) => o.sourceId === tier.id)).reduce((total, tier) => total + tier.sold, 0),
        receiptCoverageBasisPoints: expenses.length ? Math.round((expenses.filter((o) => o.hasReceipt).length * 10000) / expenses.length) : null,
      },
      events,
      monthly,
      checks: this.checks(fiscalYear, current, sheet, forecast, issuer),
      assumptions: assumptions(p.framework),
    };
    return { report, fec: fecRows(all, p, day(fiscalYear.closedAt ?? new Date())) };
  }

  private async live(fiscalYear: FiscalYear, workspaceId: string) {
    const [ledger, issuer] = await Promise.all([this.repository.loadLedger(workspaceId), this.issuer(workspaceId)]);
    return this.buildReport(fiscalYear, ledger, issuer);
  }

  /** Frozen statements for a closed year, live ones otherwise. */
  async getReport(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "finance.read");
    const fiscalYear = await this.repository.getFiscalYear(id, workspaceId);
    const live = await this.live(fiscalYear, workspaceId);
    if (!fiscalYear.closedSnapshot) return { ...live.report, source: "LIVE" as const, liveMatchesSnapshot: null };
    const snapshot = fiscalYear.closedSnapshot as unknown as Snapshot;
    const frozen = (report: AccountingReport) => stableStringify([report.incomeStatement, report.balanceSheet]);
    return {
      ...snapshot.report,
      fiscalYear: { ...snapshot.report.fiscalYear, closedAt: fiscalYear.closedAt?.toISOString() ?? null, closedHash: fiscalYear.closedHash },
      source: "SNAPSHOT" as const,
      integrityVerified: hash(snapshot) === fiscalYear.closedHash,
      liveMatchesSnapshot: frozen(live.report) === frozen(snapshot.report),
    };
  }

  async exportFec(id: string, workspaceId: string, role: UserRole) {
    requireCan(role, "finance.read");
    const fiscalYear = await this.repository.getFiscalYear(id, workspaceId);
    const fec = fiscalYear.closedSnapshot ? (fiscalYear.closedSnapshot as unknown as Snapshot).fec : (await this.live(fiscalYear, workspaceId)).fec;
    const siren = (await this.issuer(workspaceId)).siret.slice(0, 9) || "000000000";
    return { fileName: `${siren}FEC${day(fiscalYear.endsOn).replaceAll("-", "")}.txt`, content: encodeLatin9(`${fec.join("\r\n")}\r\n`) };
  }

  async closeFiscalYear(id: string, workspaceId: string, role: UserRole, userId: string) {
    requireCan(role, "finance.write");
    const fiscalYear = await this.getOpenFiscalYear(id, workspaceId);
    const closedAt = new Date();
    const { report, fec } = await this.live({ ...fiscalYear, closedAt }, workspaceId);
    const blocking = report.checks.filter((check) => check.severity === "error");
    if (day(fiscalYear.endsOn) >= toDay(closedAt)) throw new ConflictError("L'exercice ne peut être clôturé qu'après sa date de fin");
    if (blocking.length) throw new ConflictError(`Clôture impossible : ${blocking.map((check) => check.message).join(" ")}`);
    const snapshot: Snapshot = { report: { ...report, fiscalYear: { ...report.fiscalYear, closedAt: null } }, fec };
    return this.repository.closeFiscalYear(id, userId, snapshot as unknown as Prisma.InputJsonValue, hash(snapshot));
  }

  /** Actual and projected income statement of one event, by account. */
  async getEventStatement(eventId: string, workspaceId: string, role: UserRole) {
    requireCan(role, "finance.read");
    const ledger = await this.repository.loadLedger(workspaceId, eventId);
    const event = ledger.events[0];
    if (!event) throw new NotFoundError("Evenement introuvable");
    const fiscalYear = await this.repository.findFiscalYearCovering(workspaceId, event.startsAt);
    const framework = fiscalYear?.framework ?? "ASSOCIATION";
    const actualOperations = buildOperations(ledger, framework, ["ACTUAL"]);
    const projectedOperations = [...actualOperations, ...buildOperations(ledger, framework, ["FORECAST"])];
    const actual = incomeStatement(actualOperations, framework);
    const projected = incomeStatement(projectedOperations, framework);

    const accounts = new Map<string, { account: string; label: string; kind: "PRODUCT" | "CHARGE"; actualCents: number; projectedCents: number }>();
    for (const [statement, field] of [[actual, "actualCents"], [projected, "projectedCents"]] as const) {
      for (const section of statement.sections) {
        for (const line of section.lines) {
          const entry = accounts.get(line.account) ?? { account: line.account, label: line.label, kind: section.kind, actualCents: 0, projectedCents: 0 };
          entry[field] += line.amountCents;
          accounts.set(line.account, entry);
        }
      }
    }
    const positions = positionsAt(actualOperations, toDay(new Date()));
    const missingReceipts = actualOperations.filter((o) => o.kind === "expense" && !o.hasReceipt);
    return {
      event: { id: event.id, name: event.name, date: toDay(event.startsAt), vatMode: event.vatMode },
      framework,
      fiscalYear: fiscalYear ? { id: fiscalYear.id, label: fiscalYear.label } : null,
      actual,
      projected,
      accounts: [...accounts.values()].sort((a, b) => b.kind.localeCompare(a.kind) || a.account.localeCompare(b.account)),
      vat: vatSummary(actualOperations),
      outstanding: { receivablesCents: positions.receivablesCents, suppliersCents: positions.suppliersCents, membersCents: positions.membersCents },
      missingReceipts: { count: missingReceipts.length, amountCents: missingReceipts.reduce((total, o) => total + o.ttcCents, 0) },
    };
  }
}
