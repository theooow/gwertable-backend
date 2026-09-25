import PDFDocument from "pdfkit";
import { ValidationError } from "../lib/errors.js";

export async function contractPdf(content: string, proof?: string) {
  if (!/^[\x20-\x7e\xa0-\xff\n\r\tŒœŸ€’‘“”–—…]*$/.test(content + (proof ?? ""))) {
    throw new ValidationError("Le PDF accepte les caractères latins, sans emoji. Vérifiez le nom du bénévole, de l’événement et le texte de la convention.");
  }
  const doc = new PDFDocument({ size: "A4", margins: { top: 66, bottom: 64, left: 52, right: 52 }, bufferPages: true,
    info: { Title: "Convention de bénévolat", Author: "Organisateur de l’événement", Subject: "Engagement bénévole et missions convenues" } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const ink = "#163A40", accent = "#137E76", muted = "#587074";
  const width = doc.page.width - 104;
  const headings = new Set(["Les parties", "Objet et mission", "Engagement bénévole", "Accueil et conditions de participation", "Modification de la mission", "Données personnelles", "Acceptation et signature", "Conditions complémentaires"]);
  const room = (height: number) => { if (doc.y + height > doc.page.height - 76) doc.addPage(); };
  const section = (title: string) => {
    room(76);
    doc.moveDown(0.6);
    const y = doc.y;
    doc.roundedRect(52, y, width, 29, 5).fill("#EDF5F2");
    doc.font("Helvetica-Bold").fontSize(12).fillColor(ink).text(title, 64, y + 8, { width: width - 24 });
    doc.x = 52; doc.y = y + 39;
  };
  doc.fillColor(accent).font("Helvetica-Bold").fontSize(9).text("VIE ASSOCIATIVE  /  ENGAGEMENT BÉNÉVOLE", { characterSpacing: 1.4 });
  const lines = content.split(/\r?\n/);
  doc.moveDown(1.2).fillColor(ink).fontSize(27).text(lines.shift() || "Convention de bénévolat", { width });
  doc.moveDown(0.7).font("Helvetica").fontSize(10).fillColor(muted).text("Un engagement libre, des missions partagées.");
  doc.moveDown(1);
  for (const line of lines) {
    if (!line.trim()) { doc.moveDown(0.4); continue; }
    if (headings.has(line)) { section(line); continue; }
    const isPost = line.startsWith("Poste :");
    doc.font(isPost ? "Helvetica-Bold" : "Helvetica").fontSize(10.5);
    room(isPost ? 60 : Math.min(50, doc.heightOfString(line, { width, lineGap: 3 })));
    doc.fillColor(isPost ? accent : ink).text(line, 52, doc.y, { width, lineGap: 3, paragraphGap: 5 });
  }
  if (proof) {
    doc.addPage();
    doc.fillColor(accent).font("Helvetica-Bold").fontSize(9).text("ATTESTATION  /  SIGNATURE ÉLECTRONIQUE SIMPLE", { characterSpacing: 1 });
    doc.moveDown(1.2).fillColor(ink).fontSize(25).text("L’engagement confirmé");
    doc.moveDown().font("Helvetica").fontSize(10.5).text(proof, { width, lineGap: 5 });
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.rect(0, 0, doc.page.width, 7).fill(accent);
    doc.moveTo(52, 790).lineTo(doc.page.width - 52, 790).strokeColor("#C9DAD6").lineWidth(0.5).stroke();
    // Footer is outside the text area; disable wrapping to avoid creating a page.
    doc.font("Helvetica").fontSize(8).fillColor(muted).text("CONVENTION DE BÉNÉVOLAT  ·  Exemplaire personnel", 52, 801, { lineBreak: false });
    doc.text(`${i + 1} / ${pages.count}`, doc.page.width - 80, 801, { lineBreak: false });
  }
  doc.end();
  return result;
}
