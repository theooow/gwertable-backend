import PDFDocument from "pdfkit";

type Issuer = { legalName: string; siren: string | null; siret: string | null; vatNumber: string | null; addressLine1: string | null; addressLine2: string | null; postalCode: string | null; city: string | null; countryCode: string };
type Invoice = { number: string | null; counterpartName: string; counterpartSiren?: string | null; issuedAt: Date | null; dueAt?: Date | null; notes?: string | null; totalHtCents: number; totalVatCents: number; totalTtcCents: number; lines: Array<{ label: string; quantity: unknown; unitPriceHtCents: number; totalTtcCents: number }> };

export async function renderInvoicePdf(invoice: Invoice, issuer: Issuer | null) {
  const doc = new PDFDocument({ margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  const euro = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} EUR`;
  const date = (value: Date) => value.toLocaleDateString("fr-FR", { timeZone: "UTC" });
  doc.font("Helvetica-Bold").fontSize(24).fillColor("#162b37").text(invoice.number ? "FACTURE" : "BROUILLON");
  doc.font("Helvetica").fontSize(10).fillColor("#667580").text(invoice.number ?? "Document non émis");
  doc.moveDown(2).font("Helvetica-Bold").fontSize(12).fillColor("#162b37").text(issuer?.legalName ?? "Entreprise émettrice à renseigner");
  doc.font("Helvetica").fontSize(10);
  if (issuer) {
    for (const line of [issuer.addressLine1, issuer.addressLine2, [issuer.postalCode, issuer.city].filter(Boolean).join(" "), issuer.countryCode]) if (line) doc.text(line);
    if (issuer.siren) doc.text(`SIREN : ${issuer.siren}`);
    if (issuer.siret) doc.text(`SIRET : ${issuer.siret}`);
    if (issuer.vatNumber) doc.text(`TVA : ${issuer.vatNumber}`);
  }
  doc.moveDown().font("Helvetica-Bold").text(`Client : ${invoice.counterpartName}`).font("Helvetica");
  if (invoice.counterpartSiren) doc.text(`SIREN : ${invoice.counterpartSiren}`);
  if (invoice.issuedAt) doc.text(`Date d'émission : ${date(invoice.issuedAt)}`);
  if (invoice.dueAt) doc.text(`Échéance : ${date(invoice.dueAt)}`);
  doc.moveDown(2);
  for (const line of invoice.lines) {
    if (doc.y > 670) doc.addPage();
    doc.font("Helvetica-Bold").text(line.label, { width: 490 });
    doc.font("Helvetica").fillColor("#667580").text(`${line.quantity} x ${euro(line.unitPriceHtCents)} HT — ${euro(line.totalTtcCents)} TTC`).fillColor("#162b37").moveDown();
  }
  if (doc.y > 640) doc.addPage();
  doc.moveDown().font("Helvetica").text(`Total HT : ${euro(invoice.totalHtCents)}`, { align: "right" }).text(`TVA : ${euro(invoice.totalVatCents)}`, { align: "right" });
  doc.moveDown(0.5).font("Helvetica-Bold").fontSize(14).text(`Total TTC : ${euro(invoice.totalTtcCents)}`, { align: "right" });
  if (invoice.notes) doc.moveDown(2).font("Helvetica").fontSize(10).text(invoice.notes, { align: "left" });
  doc.end();
  return done;
}
