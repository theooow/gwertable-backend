import PDFDocument from "pdfkit";

export async function renderInvoicePdf(invoice: { number: string | null; counterpartName: string; issuedAt: Date | null; totalHtCents: number; totalVatCents: number; totalTtcCents: number; lines: Array<{ label: string; quantity: unknown; unitPriceHtCents: number; totalTtcCents: number }> }, issuer: string) {
  const doc = new PDFDocument({ margin: 48 }); const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const euro = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
  doc.fontSize(22).text("FACTURE"); doc.moveDown().fontSize(11).text(issuer).text(`Client : ${invoice.counterpartName}`).text(`N° : ${invoice.number ?? "Brouillon"}`).text(`Date : ${(invoice.issuedAt ?? new Date()).toLocaleDateString("fr-FR")}`); doc.moveDown();
  invoice.lines.forEach((line) => doc.text(`${line.label} — ${line.quantity} × ${euro(line.unitPriceHtCents)} HT`, { continued: true }).text(euro(line.totalTtcCents), { align: "right" }));
  doc.moveDown().font("Helvetica-Bold").text(`Total HT : ${euro(invoice.totalHtCents)}`, { align: "right" }).text(`TVA : ${euro(invoice.totalVatCents)}`, { align: "right" }).text(`Total TTC : ${euro(invoice.totalTtcCents)}`, { align: "right" }); doc.end();
  return done;
}
