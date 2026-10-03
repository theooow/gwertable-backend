import PDFDocument from "pdfkit";
import type { BalanceLine } from "../lib/accounting.js";
import type { AccountingReport } from "./accounting.service.js";

const ink = "#163A40", accent = "#137E76", muted = "#587074", line = "#C9DAD6", soft = "#EDF5F2", danger = "#B42318";

/** Standard PDF fonts only cover WinAnsi: anything else is replaced. */
function latin(text: string) {
  return text.replace(/[  ]/g, " ").replace(/[^\x20-\x7e\xa0-\xff\n’‘“”–—…€ŒœŸ]/g, "?");
}

export function formatCents(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const [units, decimals] = (Math.abs(cents) / 100).toFixed(2).split(".");
  return `${sign}${units.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${decimals} €`;
}

function formatDay(day: string) {
  const [year, month, date] = day.slice(0, 10).split("-");
  return `${date}/${month}/${year}`;
}

export async function accountsPdf(report: AccountingReport & { source: "LIVE" | "SNAPSHOT" }) {
  const { fiscalYear, issuer } = report;
  const association = fiscalYear.framework === "ASSOCIATION";
  const doc = new PDFDocument({
    size: "A4", margins: { top: 60, bottom: 64, left: 52, right: 52 }, bufferPages: true,
    info: { Title: latin(`Comptes annuels - ${fiscalYear.label}`), Author: latin(issuer.legalName || issuer.name), Subject: "Compte de résultat et bilan simplifié" },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const left = 52;
  const width = doc.page.width - 104;
  const room = (height: number) => { if (doc.y + height > doc.page.height - 80) doc.addPage(); };
  const text = (value: string, options: PDFKit.Mixins.TextOptions = {}) => doc.text(latin(value), options);

  const heading = (kicker: string, title: string) => {
    doc.fillColor(accent).font("Helvetica-Bold").fontSize(9);
    text(kicker.toUpperCase(), { characterSpacing: 1.2 });
    doc.moveDown(0.6).fillColor(ink).fontSize(22);
    text(title, { width });
    doc.moveDown(0.8);
  };

  const row = (label: string, amount: string, options: { bold?: boolean; fill?: string; indent?: number; color?: string } = {}) => {
    room(22);
    const y = doc.y;
    if (options.fill) doc.rect(left, y - 4, width, 20).fill(options.fill);
    doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(options.color ?? ink);
    doc.text(latin(label), left + 8 + (options.indent ?? 0), y, { width: width - 150 - (options.indent ?? 0), lineBreak: false, ellipsis: true });
    doc.text(latin(amount), left + width - 140, y, { width: 132, align: "right", lineBreak: false });
    doc.x = left;
    doc.y = y + 20;
  };

  const rule = () => {
    doc.moveTo(left, doc.y - 2).lineTo(left + width, doc.y - 2).strokeColor(line).lineWidth(0.5).stroke();
    doc.moveDown(0.3);
  };

  // ── Cover ────────────────────────────────────────────────────────────────
  heading(association ? "Association  /  Comptes annuels" : "Société  /  Comptes annuels", `Comptes de l'exercice ${fiscalYear.label}`);
  doc.font("Helvetica").fontSize(11).fillColor(muted);
  text(`Exercice du ${formatDay(fiscalYear.startsOn)} au ${formatDay(fiscalYear.endsOn)}`);
  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(ink);
  text(issuer.legalName || issuer.name);
  doc.font("Helvetica").fontSize(10).fillColor(ink);
  for (const value of [
    issuer.legalForm,
    [issuer.address, [issuer.postalCode, issuer.city].filter(Boolean).join(" "), issuer.country].filter(Boolean).join(", "),
    issuer.siret && `SIRET : ${issuer.siret}`,
    issuer.rna && `RNA : ${issuer.rna}`,
  ]) if (value) text(value);
  doc.moveDown(1.5);
  text(`Référentiel : ${association ? "règlement ANC n° 2018-06 relatif aux comptes annuels des personnes morales de droit privé à but non lucratif" : "règlement ANC n° 2014-03 relatif au plan comptable général"}.`, { width });
  doc.moveDown(1.5);

  const status = fiscalYear.closedAt
    ? `Exercice clôturé le ${formatDay(fiscalYear.closedAt)}. États figés, empreinte SHA-256 : ${fiscalYear.closedHash}`
    : "DOCUMENT PROVISOIRE - exercice non clôturé. Les montants peuvent encore évoluer.";
  const statusY = doc.y;
  doc.font("Helvetica-Bold").fontSize(9.5);
  const statusHeight = doc.heightOfString(latin(status), { width: width - 24 }) + 20;
  doc.roundedRect(left, statusY, width, statusHeight, 5).fill(fiscalYear.closedAt ? soft : "#FDECEA");
  doc.fillColor(fiscalYear.closedAt ? ink : danger).text(latin(status), left + 12, statusY + 10, { width: width - 24 });
  doc.x = left;
  doc.y = statusY + statusHeight + 16;
  doc.font("Helvetica").fontSize(9).fillColor(muted);
  text("États établis à partir des données de gestion saisies dans l'application. Ils constituent une base de travail et doivent être revus, complétés (immobilisations, amortissements, provisions, stocks, charges sociales, impôts) et validés par la personne responsable des comptes ou un expert-comptable avant approbation.", { width, lineGap: 2 });

  // ── Balance sheet ────────────────────────────────────────────────────────
  doc.addPage();
  heading("Bilan simplifié", `Situation au ${formatDay(fiscalYear.endsOn)}`);
  const sheet = report.balanceSheet;
  const lines = (title: string, entries: BalanceLine[], total: number) => {
    row(title, "", { bold: true, fill: soft });
    for (const entry of entries.filter((e) => e.amountCents !== 0 || e.key === "cash" || e.key === "result")) {
      row(`${entry.label}  (${entry.account})`, formatCents(entry.amountCents), { indent: 8 });
    }
    rule();
    row(`Total ${title.toLowerCase()}`, formatCents(total), { bold: true });
    doc.moveDown(0.6);
  };
  lines("Actif", sheet.assets, sheet.totalAssetsCents);
  lines(association ? "Fonds propres" : "Capitaux propres", sheet.equity, sheet.totalEquityCents);
  lines("Dettes", sheet.liabilities, sheet.totalLiabilitiesCents);
  row("Total passif", formatCents(sheet.totalEquityCents + sheet.totalLiabilitiesCents), { bold: true, fill: soft });
  if (!sheet.balanced) row("Le bilan n'est pas équilibré", "", { color: danger, bold: true });

  // ── Income statement ─────────────────────────────────────────────────────
  doc.addPage();
  heading("Compte de résultat", `Du ${formatDay(fiscalYear.startsOn)} au ${formatDay(fiscalYear.endsOn)}`);
  const statement = report.incomeStatement;
  for (const kind of ["PRODUCT", "CHARGE"] as const) {
    row(kind === "PRODUCT" ? "Produits d'exploitation" : "Charges d'exploitation", "", { bold: true, fill: soft });
    for (const section of statement.sections.filter((s) => s.kind === kind)) {
      row(section.label, formatCents(section.totalCents), { bold: true, indent: 4 });
      for (const entry of section.lines) row(`${entry.account}  ${entry.label}`, formatCents(entry.amountCents), { indent: 16, color: muted });
    }
    rule();
    row(kind === "PRODUCT" ? "Total des produits" : "Total des charges", formatCents(kind === "PRODUCT" ? statement.totalProductsCents : statement.totalChargesCents), { bold: true });
    doc.moveDown(0.6);
  }
  row(statement.resultLabel, formatCents(statement.resultCents), { bold: true, fill: soft, color: statement.resultCents < 0 ? danger : ink });

  // ── Notes ────────────────────────────────────────────────────────────────
  doc.addPage();
  heading("Annexe", "Informations complémentaires");
  row("TVA", "", { bold: true, fill: soft });
  row("TVA collectée", formatCents(report.vat.collectedCents), { indent: 8 });
  row("TVA déductible", formatCents(report.vat.deductibleCents), { indent: 8 });
  row(report.vat.netCents >= 0 ? "TVA nette due" : "Crédit de TVA", formatCents(Math.abs(report.vat.netCents)), { indent: 8, bold: true });
  doc.moveDown(0.6);
  row("Rapprochement bancaire", "", { bold: true, fill: soft });
  row("Trésorerie à l'ouverture", formatCents(sheet.openingCashCents), { indent: 8 });
  row("Trésorerie calculée à la clôture", formatCents(sheet.computedCashCents), { indent: 8 });
  row("Solde bancaire déclaré", sheet.declaredBankBalanceCents === null ? "non renseigné" : formatCents(sheet.declaredBankBalanceCents), { indent: 8 });
  if (sheet.bankGapCents) row("Écart", formatCents(sheet.bankGapCents), { indent: 8, bold: true, color: danger });
  doc.moveDown(0.8);

  const paragraphs = (title: string, items: string[]) => {
    if (!items.length) return;
    row(title, "", { bold: true, fill: soft });
    doc.font("Helvetica").fontSize(9.5).fillColor(ink);
    for (const item of items) {
      room(doc.heightOfString(latin(item), { width: width - 24 }) + 6);
      text(`•  ${item}`, { width: width - 16, indent: 0, lineGap: 2, paragraphGap: 4 });
    }
    doc.x = left;
    doc.moveDown(0.6);
  };
  paragraphs("Méthodes et hypothèses retenues", report.assumptions);
  paragraphs("Points de contrôle", report.checks.map((check) => `${check.severity === "error" ? "[Bloquant] " : check.severity === "warning" ? "[À vérifier] " : ""}${check.message}${check.amountCents ? ` (${formatCents(check.amountCents)})` : ""}${check.count ? ` - ${check.count} ligne(s)` : ""}`));

  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.rect(0, 0, doc.page.width, 7).fill(accent);
    doc.moveTo(52, 790).lineTo(doc.page.width - 52, 790).strokeColor(line).lineWidth(0.5).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(muted);
    // Footer is outside the text area; disable wrapping to avoid creating a page.
    doc.text(latin(`${issuer.legalName || issuer.name}  ·  ${fiscalYear.label}  ·  ${report.source === "SNAPSHOT" ? "États clôturés" : "Provisoire"}  ·  Généré le ${formatDay(report.generatedAt)}`), 52, 801, { lineBreak: false });
    doc.text(`${i + 1} / ${pages.count}`, doc.page.width - 80, 801, { lineBreak: false });
  }
  doc.end();
  return result;
}
