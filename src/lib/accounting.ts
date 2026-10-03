import type { AccountingFramework, BudgetPhase, ReimbStatus, VatMode } from "@prisma/client";

/**
 * Accounting engine. Turns budget lines into operations classified in the
 * French chart of accounts (PCG, and ANC 2018-06 for associations), then derives
 * the income statement, the simplified balance sheet and FEC entries.
 *
 * Revenue and charges are recognised on the event date (taxable event), cash
 * movements on the payment / receipt date. Dates are compared as Europe/Paris
 * calendar days.
 */

export type LedgerEvent = {
  id: string;
  name: string;
  startsAt: Date;
  vatMode: VatMode;
  defaultVatRateBasisPoints: number;
};

type BudgetAmounts = {
  amountCents: number;
  amountHtCents: number;
  amountTtcCents: number;
};

export type LedgerExpense = BudgetAmounts & {
  id: string;
  eventId: string;
  label: string;
  category: string;
  phase: BudgetPhase;
  paidAt: Date | null;
  paidById: string | null;
  paidByName: string | null;
  reimbursement: ReimbStatus;
  receiptUrl: string | null;
};

export type LedgerIncome = BudgetAmounts & {
  id: string;
  eventId: string;
  label: string;
  category: string;
  phase: BudgetPhase;
  receivedAt: Date | null;
  receiptUrl: string | null;
};

export type LedgerTicketTier = {
  id: string;
  eventId: string;
  name: string;
  organizerRevenueCents: number;
  sold: number;
};

export type LedgerData = {
  events: LedgerEvent[];
  expenses: LedgerExpense[];
  incomes: LedgerIncome[];
  ticketTiers: LedgerTicketTier[];
};

export type Account = { number: string; label: string };

export const ACCOUNTS = {
  cash: { number: "512", label: "Banque" },
  suppliers: { number: "401", label: "Fournisseurs" },
  customers: { number: "411", label: "Clients et usagers" },
  members: { number: "467", label: "Autres comptes débiteurs ou créditeurs" },
  partners: { number: "455", label: "Associés - comptes courants" },
  vatDeductible: { number: "44566", label: "TVA déductible sur autres biens et services" },
  vatCollected: { number: "44571", label: "TVA collectée" },
  retainedEarnings: { number: "110", label: "Report à nouveau (solde créditeur)" },
  retainedLosses: { number: "119", label: "Report à nouveau (solde débiteur)" },
  donations: { number: "7541", label: "Dons manuels - abandons de frais" },
} as const satisfies Record<string, Account>;

const EXPENSE_ACCOUNTS: Record<string, Account> = {
  lieu: { number: "6132", label: "Locations immobilières" },
  son: { number: "6135", label: "Locations mobilières" },
  "lumière": { number: "6135", label: "Locations mobilières" },
  "matériel": { number: "6135", label: "Locations mobilières" },
  boissons: { number: "607", label: "Achats de marchandises" },
  nourriture: { number: "6257", label: "Réceptions" },
  "déco": { number: "6063", label: "Fournitures d'entretien et de petit équipement" },
  courses: { number: "6068", label: "Autres matières et fournitures" },
  artistes: { number: "604", label: "Achats de prestations de services" },
  communication: { number: "623", label: "Publicité, publications, relations publiques" },
  transport: { number: "624", label: "Transports de biens et transports collectifs" },
  assurance: { number: "616", label: "Primes d'assurances" },
  "sécurité": { number: "611", label: "Sous-traitance générale" },
  vestiaire: { number: "611", label: "Sous-traitance générale" },
  safer: { number: "611", label: "Sous-traitance générale" },
};
const OTHER_EXPENSE: Account = { number: "6288", label: "Autres charges externes diverses" };

const INCOME_ACCOUNTS: Record<string, Account> = {
  bar: { number: "707", label: "Ventes de marchandises" },
  merch: { number: "707", label: "Ventes de marchandises" },
  caisse: { number: "706", label: "Prestations de services" },
  sponsor: { number: "706", label: "Prestations de services" },
};
const TICKETING: Account = { number: "706", label: "Prestations de services" };
const OTHER_INCOME: Account = { number: "758", label: "Produits divers de gestion courante" };

export function expenseAccount(category: string): Account {
  return EXPENSE_ACCOUNTS[category] ?? OTHER_EXPENSE;
}

export function incomeAccount(category: string): Account {
  return INCOME_ACCOUNTS[category] ?? OTHER_INCOME;
}

type Counterpart = "SUPPLIER" | "MEMBER" | "PARTNER" | "CUSTOMER" | "DONATION";

export type Operation = {
  kind: "expense" | "income";
  sourceId: string;
  eventId: string;
  eventName: string;
  label: string;
  /** Europe/Paris calendar day, YYYY-MM-DD. */
  date: string;
  settledOn: string | null;
  account: Account;
  htCents: number;
  vatCents: number;
  ttcCents: number;
  counterpart: Counterpart;
  counterpartId: string | null;
  counterpartName: string | null;
  hasReceipt: boolean;
  isTicketing: boolean;
};

const parisDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

export function toDay(date: Date): string {
  return parisDay.format(date);
}

function splitAmounts(line: BudgetAmounts, event: LedgerEvent) {
  const ttcCents = line.amountTtcCents || line.amountCents;
  if (event.vatMode !== "ASSUJETTI") return { htCents: ttcCents, vatCents: 0, ttcCents };
  const htCents = line.amountTtcCents ? line.amountHtCents : ttcCents;
  return { htCents, vatCents: ttcCents - htCents, ttcCents };
}

function expenseCounterpart(expense: LedgerExpense, framework: AccountingFramework): { counterpart: Counterpart; settledAt: Date | null } {
  if (!expense.paidById) return { counterpart: "SUPPLIER", settledAt: expense.paidAt };
  if (expense.reimbursement === "PENDING") return { counterpart: "MEMBER", settledAt: null };
  if (expense.reimbursement === "NOT_OWED") {
    return framework === "ASSOCIATION" ? { counterpart: "DONATION", settledAt: null } : { counterpart: "PARTNER", settledAt: null };
  }
  return { counterpart: "MEMBER", settledAt: expense.paidAt };
}

/**
 * Builds the operations of one budget phase. Ticketing is always recognised
 * from sold tickets and considered collected on the event date.
 */
export function buildOperations(data: LedgerData, framework: AccountingFramework, phases: BudgetPhase[]): Operation[] {
  const events = new Map(data.events.map((event) => [event.id, event]));
  const operations: Operation[] = [];

  for (const expense of data.expenses) {
    const event = events.get(expense.eventId);
    if (!event || !phases.includes(expense.phase)) continue;
    const date = toDay(event.startsAt);
    const { counterpart, settledAt } = expenseCounterpart(expense, framework);
    operations.push({
      kind: "expense",
      sourceId: expense.id,
      eventId: event.id,
      eventName: event.name,
      label: expense.label,
      date,
      settledOn: settledAt ? toDay(settledAt) : expense.reimbursement === "DONE" && expense.paidById ? date : null,
      account: expenseAccount(expense.category),
      ...splitAmounts(expense, event),
      counterpart,
      counterpartId: expense.paidById,
      counterpartName: expense.paidByName,
      hasReceipt: Boolean(expense.receiptUrl),
      isTicketing: false,
    });
  }

  for (const income of data.incomes) {
    const event = events.get(income.eventId);
    if (!event || !phases.includes(income.phase)) continue;
    operations.push({
      kind: "income",
      sourceId: income.id,
      eventId: event.id,
      eventName: event.name,
      label: income.label,
      date: toDay(event.startsAt),
      settledOn: income.receivedAt ? toDay(income.receivedAt) : null,
      account: incomeAccount(income.category),
      ...splitAmounts(income, event),
      counterpart: "CUSTOMER",
      counterpartId: null,
      counterpartName: null,
      hasReceipt: Boolean(income.receiptUrl),
      isTicketing: false,
    });
  }

  if (phases.includes("ACTUAL")) {
    for (const tier of data.ticketTiers) {
      const event = events.get(tier.eventId);
      const ttcCents = tier.sold * tier.organizerRevenueCents;
      if (!event || ttcCents === 0) continue;
      const htCents = event.vatMode === "ASSUJETTI" ? Math.round((ttcCents * 10000) / (10000 + event.defaultVatRateBasisPoints)) : ttcCents;
      const date = toDay(event.startsAt);
      operations.push({
        kind: "income",
        sourceId: tier.id,
        eventId: event.id,
        eventName: event.name,
        label: `Billetterie - ${tier.name} (${tier.sold} billets)`,
        date,
        settledOn: date,
        account: TICKETING,
        htCents,
        vatCents: ttcCents - htCents,
        ttcCents,
        counterpart: "CUSTOMER",
        counterpartId: null,
        counterpartName: null,
        hasReceipt: true,
        isTicketing: true,
      });
    }
  }

  return operations.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

// ── Income statement ─────────────────────────────────────────────────────────

export type StatementLine = { account: string; label: string; amountCents: number };
export type StatementSection = { key: string; label: string; kind: "PRODUCT" | "CHARGE"; lines: StatementLine[]; totalCents: number };
export type IncomeStatement = {
  sections: StatementSection[];
  totalProductsCents: number;
  totalChargesCents: number;
  resultCents: number;
  resultLabel: string;
};

const SECTIONS: { key: string; label: string; kind: "PRODUCT" | "CHARGE"; match: (account: string) => boolean }[] = [
  { key: "sales", label: "Ventes de marchandises", kind: "PRODUCT", match: (a) => a.startsWith("707") },
  { key: "services", label: "Production vendue (services)", kind: "PRODUCT", match: (a) => a.startsWith("706") },
  { key: "donations", label: "Dons et abandons de frais", kind: "PRODUCT", match: (a) => a.startsWith("754") },
  { key: "otherProducts", label: "Autres produits de gestion courante", kind: "PRODUCT", match: (a) => a.startsWith("75") },
  { key: "goods", label: "Achats de marchandises", kind: "CHARGE", match: (a) => a.startsWith("607") },
  { key: "external", label: "Autres achats et charges externes", kind: "CHARGE", match: (a) => a.startsWith("6") },
];

export function resultLabel(framework: AccountingFramework, resultCents: number): string {
  if (framework === "ASSOCIATION") return resultCents >= 0 ? "Excédent de l'exercice" : "Déficit de l'exercice";
  return resultCents >= 0 ? "Bénéfice de l'exercice (avant impôt)" : "Perte de l'exercice (avant impôt)";
}

/** Revenue and charge entries of a list of operations, donations included. */
function statementEntries(operations: Operation[]): { account: Account; cents: number }[] {
  return operations.flatMap((operation) => {
    const sign = operation.kind === "income" ? 1 : -1;
    const entries = [{ account: operation.account, cents: sign * operation.htCents }];
    if (operation.counterpart === "DONATION") entries.push({ account: ACCOUNTS.donations, cents: operation.ttcCents });
    return entries;
  });
}

export function incomeStatement(operations: Operation[], framework: AccountingFramework): IncomeStatement {
  const byAccount = new Map<string, StatementLine>();
  for (const { account, cents } of statementEntries(operations)) {
    const line = byAccount.get(account.number) ?? { account: account.number, label: account.label, amountCents: 0 };
    line.amountCents += Math.abs(cents);
    byAccount.set(account.number, line);
  }
  const remaining = [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account));
  const sections = SECTIONS.map(({ key, label, kind, match }) => {
    const lines = remaining.filter((line) => match(line.account));
    for (const line of lines) remaining.splice(remaining.indexOf(line), 1);
    return { key, label, kind, lines, totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0) };
  }).filter((section) => section.lines.length > 0);
  const totalProductsCents = sections.filter((s) => s.kind === "PRODUCT").reduce((sum, s) => sum + s.totalCents, 0);
  const totalChargesCents = sections.filter((s) => s.kind === "CHARGE").reduce((sum, s) => sum + s.totalCents, 0);
  const resultCents = totalProductsCents - totalChargesCents;
  return { sections, totalProductsCents, totalChargesCents, resultCents, resultLabel: resultLabel(framework, resultCents) };
}

// ── Balance sheet ────────────────────────────────────────────────────────────

export type Positions = {
  receivablesCents: number;
  prepaidChargesCents: number;
  suppliersCents: number;
  membersCents: number;
  partnersCents: number;
  deferredIncomeCents: number;
};

/**
 * Third-party positions at the end of `day`: recognised but unsettled lines,
 * and lines settled before their event (advances).
 */
export function positionsAt(operations: Operation[], day: string): Positions {
  const positions: Positions = { receivablesCents: 0, prepaidChargesCents: 0, suppliersCents: 0, membersCents: 0, partnersCents: 0, deferredIncomeCents: 0 };
  for (const operation of operations) {
    if (operation.counterpart === "DONATION") continue;
    const recognised = operation.date <= day;
    const settled = operation.settledOn !== null && operation.settledOn <= day;
    if (recognised === settled) continue;
    if (operation.kind === "income") {
      if (recognised) positions.receivablesCents += operation.ttcCents;
      else positions.deferredIncomeCents += operation.ttcCents;
    } else if (!recognised) {
      positions.prepaidChargesCents += operation.ttcCents;
    } else if (operation.counterpart === "MEMBER") {
      positions.membersCents += operation.ttcCents;
    } else if (operation.counterpart === "PARTNER") {
      positions.partnersCents += operation.ttcCents;
    } else {
      positions.suppliersCents += operation.ttcCents;
    }
  }
  return positions;
}

function netPositionCents(positions: Positions, cashCents: number) {
  return cashCents + positions.receivablesCents + positions.prepaidChargesCents
    - positions.suppliersCents - positions.membersCents - positions.partnersCents - positions.deferredIncomeCents;
}

export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export type BalanceLine = { key: string; label: string; account: string; amountCents: number };
export type BalanceSheet = {
  assets: BalanceLine[];
  equity: BalanceLine[];
  liabilities: BalanceLine[];
  totalAssetsCents: number;
  totalEquityCents: number;
  totalLiabilitiesCents: number;
  balanced: boolean;
  openingCashCents: number;
  openingEquityCents: number;
  computedCashCents: number;
  declaredBankBalanceCents: number | null;
  bankGapCents: number | null;
};

export type Vat = { collectedCents: number; deductibleCents: number; netCents: number };

export type Period = { startsOn: string; endsOn: string; framework: AccountingFramework; openingCashCents: number; closingBankBalanceCents: number | null };

export function vatSummary(operations: Operation[]): Vat {
  const collectedCents = operations.filter((o) => o.kind === "income").reduce((sum, o) => sum + o.vatCents, 0);
  const deductibleCents = operations.filter((o) => o.kind === "expense").reduce((sum, o) => sum + o.vatCents, 0);
  return { collectedCents, deductibleCents, netCents: collectedCents - deductibleCents };
}

export function inPeriod(day: string, period: Pick<Period, "startsOn" | "endsOn">) {
  return day >= period.startsOn && day <= period.endsOn;
}

/** Net cash movement of settlements dated within the period. */
export function cashFlowCents(operations: Operation[], period: Pick<Period, "startsOn" | "endsOn">) {
  return operations
    .filter((o) => o.settledOn !== null && inPeriod(o.settledOn, period))
    .reduce((sum, o) => sum + (o.kind === "income" ? o.ttcCents : -o.ttcCents), 0);
}

/**
 * Simplified balance sheet at the end of the period. VAT of previous periods
 * is assumed settled and included in the opening cash.
 */
export function balanceSheet(allOperations: Operation[], period: Period, statement: IncomeStatement): BalanceSheet {
  const opening = positionsAt(allOperations, previousDay(period.startsOn));
  const closing = positionsAt(allOperations, period.endsOn);
  const openingEquityCents = netPositionCents(opening, period.openingCashCents);
  const computedCashCents = period.openingCashCents + cashFlowCents(allOperations, period);
  const vat = vatSummary(allOperations.filter((o) => inPeriod(o.date, period)));
  const association = period.framework === "ASSOCIATION";

  const assets: BalanceLine[] = [
    { key: "receivables", label: association ? "Créances usagers et comptes rattachés" : "Créances clients et comptes rattachés", account: "411", amountCents: closing.receivablesCents },
    { key: "vatReceivable", label: "Autres créances - TVA à récupérer", account: "445", amountCents: Math.max(0, -vat.netCents) },
    { key: "prepaidCharges", label: "Charges constatées d'avance", account: "486", amountCents: closing.prepaidChargesCents },
    { key: "cash", label: "Disponibilités", account: "512", amountCents: Math.max(0, computedCashCents) },
  ];
  const equity: BalanceLine[] = [
    { key: "openingEquity", label: association ? "Fonds propres et report à nouveau" : "Capitaux propres et report à nouveau", account: openingEquityCents >= 0 ? "110" : "119", amountCents: openingEquityCents },
    { key: "result", label: statement.resultLabel, account: statement.resultCents >= 0 ? "120" : "129", amountCents: statement.resultCents },
  ];
  const liabilities: BalanceLine[] = [
    { key: "suppliers", label: "Dettes fournisseurs et comptes rattachés", account: "401", amountCents: closing.suppliersCents },
    { key: "members", label: association ? "Avances des membres à rembourser" : "Avances des salariés et dirigeants à rembourser", account: "467", amountCents: closing.membersCents },
    { key: "partners", label: "Comptes courants d'associés", account: "455", amountCents: closing.partnersCents },
    { key: "vatPayable", label: "Dettes fiscales - TVA à décaisser", account: "445", amountCents: Math.max(0, vat.netCents) },
    { key: "deferredIncome", label: "Produits constatés d'avance", account: "487", amountCents: closing.deferredIncomeCents },
    { key: "overdraft", label: "Concours bancaires courants", account: "512", amountCents: Math.max(0, -computedCashCents) },
  ];
  const sum = (lines: BalanceLine[]) => lines.reduce((total, line) => total + line.amountCents, 0);
  const totalAssetsCents = sum(assets);
  const totalEquityCents = sum(equity);
  const totalLiabilitiesCents = sum(liabilities);
  return {
    assets,
    equity,
    liabilities,
    totalAssetsCents,
    totalEquityCents,
    totalLiabilitiesCents,
    balanced: totalAssetsCents === totalEquityCents + totalLiabilitiesCents,
    openingCashCents: period.openingCashCents,
    openingEquityCents,
    computedCashCents,
    declaredBankBalanceCents: period.closingBankBalanceCents,
    bankGapCents: period.closingBankBalanceCents === null ? null : period.closingBankBalanceCents - computedCashCents,
  };
}

// ── FEC (art. A47 A-1 du livre des procédures fiscales) ─────────────────────

export const FEC_COLUMNS = [
  "JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef",
  "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise",
] as const;

const JOURNALS = { AN: "A-nouveaux", AC: "Achats", VE: "Ventes", BQ: "Banque", OD: "Operations diverses" } as const;
type Journal = keyof typeof JOURNALS;

type FecLine = { account: Account; auxiliary?: { id: string; label: string }; debitCents: number; creditCents: number };
type FecEntry = { journal: Journal; date: string; pieceRef: string; label: string; lines: FecLine[] };

function thirdParty(operation: Operation): { account: Account; auxiliary?: { id: string; label: string } } {
  if (operation.kind === "income") return { account: ACCOUNTS.customers };
  if (operation.counterpart === "MEMBER" && operation.counterpartId) {
    return { account: ACCOUNTS.members, auxiliary: { id: operation.counterpartId, label: operation.counterpartName ?? "Membre" } };
  }
  if (operation.counterpart === "PARTNER" && operation.counterpartId) {
    return { account: ACCOUNTS.partners, auxiliary: { id: operation.counterpartId, label: operation.counterpartName ?? "Associe" } };
  }
  return { account: ACCOUNTS.suppliers };
}

function line(account: Account, debitCents: number, creditCents: number, auxiliary?: { id: string; label: string }): FecLine {
  return { account, auxiliary, debitCents, creditCents };
}

function operationEntry(operation: Operation): FecEntry {
  const pieceRef = operation.sourceId;
  const label = `${operation.eventName} - ${operation.label}`;
  if (operation.kind === "income") {
    return {
      journal: "VE", date: operation.date, pieceRef, label, lines: [
        line(ACCOUNTS.customers, operation.ttcCents, 0),
        line(operation.account, 0, operation.htCents),
        line(ACCOUNTS.vatCollected, 0, operation.vatCents),
      ],
    };
  }
  const debit = [line(operation.account, operation.htCents, 0), line(ACCOUNTS.vatDeductible, operation.vatCents, 0)];
  if (operation.counterpart === "DONATION") {
    return { journal: "OD", date: operation.date, pieceRef, label, lines: [...debit, line(ACCOUNTS.donations, 0, operation.ttcCents)] };
  }
  const party = thirdParty(operation);
  return { journal: "AC", date: operation.date, pieceRef, label, lines: [...debit, line(party.account, 0, operation.ttcCents, party.auxiliary)] };
}

function settlementEntry(operation: Operation): FecEntry {
  const party = thirdParty(operation);
  const label = `Reglement - ${operation.eventName} - ${operation.label}`;
  const lines = operation.kind === "income"
    ? [line(ACCOUNTS.cash, operation.ttcCents, 0), line(party.account, 0, operation.ttcCents, party.auxiliary)]
    : [line(party.account, operation.ttcCents, 0, party.auxiliary), line(ACCOUNTS.cash, 0, operation.ttcCents)];
  return { journal: "BQ", date: operation.settledOn!, pieceRef: operation.sourceId, label, lines };
}

function openingEntry(allOperations: Operation[], period: Period): FecEntry | null {
  const positions = positionsAt(allOperations, previousDay(period.startsOn));
  const equityCents = netPositionCents(positions, period.openingCashCents);
  const signed = (account: Account, cents: number) => line(account, Math.max(0, cents), Math.max(0, -cents));
  const lines = [
    signed(ACCOUNTS.cash, period.openingCashCents),
    signed(ACCOUNTS.customers, positions.receivablesCents - positions.deferredIncomeCents),
    signed(ACCOUNTS.suppliers, positions.prepaidChargesCents - positions.suppliersCents),
    signed(ACCOUNTS.members, -positions.membersCents),
    signed(ACCOUNTS.partners, -positions.partnersCents),
    signed(equityCents >= 0 ? ACCOUNTS.retainedEarnings : ACCOUNTS.retainedLosses, -equityCents),
  ];
  return { journal: "AN", date: period.startsOn, pieceRef: "AN", label: "A-nouveaux", lines };
}

const LATIN9: Record<string, number> = { "€": 0xa4, "Š": 0xa6, "š": 0xa8, "Ž": 0xb4, "ž": 0xb8, "Œ": 0xbc, "œ": 0xbd, "Ÿ": 0xbe };
const LATIN1_REPLACED = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);

/** Encodes text as ISO 8859-15, one of the encodings accepted for FEC files. */
export function encodeLatin9(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (LATIN9[char] !== undefined) bytes.push(LATIN9[char]);
    else if (code <= 0xff && !LATIN1_REPLACED.has(code)) bytes.push(code);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function fecAmount(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function fecText(value: string) {
  return value.replace(/[|\r\n\t]+/g, " ").trim();
}

function fecDate(day: string) {
  return day.replaceAll("-", "");
}

/** Builds the FEC rows of the period, pipe separated, header included. */
export function fecRows(allOperations: Operation[], period: Period, validatedOn: string): string[] {
  const entries: FecEntry[] = [];
  const opening = openingEntry(allOperations, period);
  if (opening) entries.push(opening);
  for (const operation of allOperations) {
    if (inPeriod(operation.date, period)) entries.push(operationEntry(operation));
    if (operation.settledOn && inPeriod(operation.settledOn, period)) entries.push(settlementEntry(operation));
  }
  const order: Journal[] = ["AN", "AC", "VE", "OD", "BQ"];
  entries.sort((a, b) => a.date.localeCompare(b.date) || order.indexOf(a.journal) - order.indexOf(b.journal));

  const rows: string[] = [FEC_COLUMNS.join("|")];
  let number = 0;
  for (const entry of entries) {
    const lines = entry.lines.filter((l) => l.debitCents !== 0 || l.creditCents !== 0);
    if (lines.length === 0) continue;
    number += 1;
    for (const l of lines) {
      rows.push([
        entry.journal, JOURNALS[entry.journal], String(number).padStart(6, "0"), fecDate(entry.date), l.account.number, fecText(l.account.label),
        l.auxiliary?.id ?? "", fecText(l.auxiliary?.label ?? ""), fecText(entry.pieceRef), fecDate(entry.date), fecText(entry.label),
        fecAmount(l.debitCents), fecAmount(l.creditCents), "", "", fecDate(validatedOn), "", "",
      ].join("|"));
    }
  }
  return rows;
}
