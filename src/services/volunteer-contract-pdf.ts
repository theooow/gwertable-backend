import PDFDocument from "pdfkit";
import { ValidationError } from "../lib/errors.js";

export async function contractPdf(content: string, proof?: string) {
  if (!/^[\x20-\x7e\xa0-\xff\n\r\tŒœŸ€’‘“”–—…]*$/.test(content + (proof ?? ""))) {
    throw new ValidationError("Le PDF accepte les caractères latins, sans emoji. Vérifiez le nom du bénévole, de l’événement et le texte de la convention.");
  }
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: "Convention de bénévolat" } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.font("Helvetica").fontSize(11).text(content, { lineGap: 4 });
  if (proof) {
    doc.addPage().font("Helvetica-Bold").fontSize(16).text("Attestation de signature électronique");
    doc.moveDown().font("Helvetica").fontSize(10).text(proof, { lineGap: 4 });
  }
  doc.end();
  return result;
}
