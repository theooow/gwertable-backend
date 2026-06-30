import { ValidationError } from "../lib/errors.js";

export type DocumentType = "quote" | "invoice" | "unknown";

export type ExtractedEquipmentLine = {
  name: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  rentalCoef: number;
  notes?: string | null;
  confidence?: number;
};

export type EquipmentImportPreview = {
  label: string;
  documentType: DocumentType;
  discountCents: number | null;
  discountPct: number | null;
  lines: ExtractedEquipmentLine[];
  warnings: string[];
};

export interface DocumentExtractionProvider {
  extract(input: {
    fileName: string;
    contentType: string;
    dataBase64: string;
    textHint?: string;
  }): Promise<EquipmentImportPreview>;
}

const ANALYZABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

function centsFromAmount(value: string) {
  const amount = Number.parseFloat(value.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function stripPdfEscapes(value: string) {
  return value.replace(/\\([()\\])/g, "$1").replace(/\\n/g, " ").trim();
}

export function extractLocalPdfPreview(fileName: string, buffer: Buffer): EquipmentImportPreview | null {
  const raw = buffer.toString("latin1");
  const chunks = [...raw.matchAll(/\(([^()]*)\)/g)]
    .map((match) => stripPdfEscapes(match[1] ?? ""))
    .filter((value) => /[A-Za-zÀ-ÿ0-9]/.test(value));
  const text = chunks.length >= 3
    ? chunks.join("\n")
    : raw.replace(/[^\x20-\x7EÀ-ÿ\r\n,.;:%€-]/g, " ");
  const lines = text.split(/\r?\n| {2,}/).map((line) => line.trim()).filter(Boolean);

  const extracted: ExtractedEquipmentLine[] = [];
  let discountCents: number | null = null;
  let discountPct: number | null = null;
  let documentType: DocumentType = "unknown";

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("facture")) documentType = "invoice";
    if (lower.includes("devis")) documentType = documentType === "invoice" ? documentType : "quote";

    const pct = line.match(/(?:remise|discount)[^\d]*(\d+(?:[,.]\d+)?)\s*%/i);
    if (pct) {
      discountPct = Number.parseFloat(pct[1].replace(",", "."));
      continue;
    }
    const discount = line.match(/(?:remise|discount)[^\d]*(\d+(?:[,.]\d+)?)\s*(?:€|eur)?/i);
    if (discount) {
      discountCents = centsFromAmount(discount[1]);
      continue;
    }

    const match = line.match(/^(.+?)\s+(?:x\s*)?(\d+)\s+(\d+(?:[,.]\d{1,2})?)\s*(?:€|eur)?(?:\s|$)/i);
    if (!match) continue;
    const name = match[1].replace(/[-:]+$/, "").trim();
    const quantity = Number.parseInt(match[2], 10);
    const unitPriceCents = centsFromAmount(match[3]);
    if (!name || unitPriceCents == null) continue;

    extracted.push({
      name,
      category: "location",
      quantity,
      unitPriceCents,
      rentalCoef: 1,
      confidence: 0.72,
    });
  }

  if (extracted.length === 0) return null;

  return {
    label: fileName.replace(/\.[^.]+$/, "") || "Import matos",
    documentType,
    discountCents,
    discountPct,
    lines: extracted,
    warnings: ["Extraction locale PDF : verifie les quantites et prix avant import."],
  };
}

function parseProviderJson(value: unknown, fallbackLabel: string): EquipmentImportPreview {
  const parsed = value as Partial<EquipmentImportPreview>;
  const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
  return {
    label: typeof parsed.label === "string" && parsed.label.trim() ? parsed.label.trim() : fallbackLabel,
    documentType: parsed.documentType === "quote" || parsed.documentType === "invoice" ? parsed.documentType : "unknown",
    discountCents: typeof parsed.discountCents === "number" ? Math.max(0, Math.round(parsed.discountCents)) : null,
    discountPct: typeof parsed.discountPct === "number" ? Math.min(100, Math.max(0, parsed.discountPct)) : null,
    lines: lines.map((line) => {
      const item = line as Partial<ExtractedEquipmentLine>;
      return {
        name: String(item.name ?? "").trim(),
        category: String(item.category ?? "location").trim() || "location",
        quantity: Math.max(1, Math.round(Number(item.quantity ?? 1))),
        unitPriceCents: Math.max(0, Math.round(Number(item.unitPriceCents ?? 0))),
        rentalCoef: Math.max(0, Number(item.rentalCoef ?? 1)),
        notes: item.notes ? String(item.notes) : null,
        confidence: typeof item.confidence === "number" ? Math.min(1, Math.max(0, item.confidence)) : undefined,
      };
    }).filter((line) => line.name),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
  };
}

function parseProviderText(text: string, fallbackLabel: string) {
  try {
    return parseProviderJson(JSON.parse(text), fallbackLabel);
  } catch {
    throw new ValidationError("Le provider d'extraction n'a pas retourne un JSON valide.");
  }
}

function openAiOutputText(payload: unknown) {
  const response = payload as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  if (response.output_text) return response.output_text;
  return response.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("") ?? "";
}

function extractionPrompt(textHint?: string) {
  return [
    "Extract equipment rental quote/invoice lines as strict JSON.",
    "Schema: {label:string,documentType:'quote'|'invoice'|'unknown',discountCents:number|null,discountPct:number|null,lines:[{name:string,category:string,quantity:number,unitPriceCents:number,rentalCoef:number,notes:string|null,confidence:number}],warnings:string[]}.",
    "Use cents for money. Do not create catalog matches. Invoices are treated as equipment quotes.",
    textHint ? `Readable text hint:\n${textHint.slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n\n");
}

class OpenAiDocumentExtractionProvider implements DocumentExtractionProvider {
  async extract(input: { fileName: string; contentType: string; dataBase64: string; textHint?: string }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ValidationError("Provider OpenAI non configure: OPENAI_API_KEY est requis.");
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: extractionPrompt(input.textHint) },
            { type: "input_file", filename: input.fileName, file_data: `data:${input.contentType};base64,${input.dataBase64}` },
          ],
        }],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!response.ok) throw new ValidationError(`Extraction OpenAI impossible (${response.status}).`);
    const payload = await response.json();
    return parseProviderText(openAiOutputText(payload), input.fileName.replace(/\.[^.]+$/, ""));
  }
}

class OllamaDocumentExtractionProvider implements DocumentExtractionProvider {
  async extract(input: { fileName: string; contentType: string; dataBase64: string; textHint?: string }) {
    const model = process.env.OLLAMA_MODEL;
    if (!model) throw new ValidationError("Provider Ollama non configure: OLLAMA_MODEL est requis.");
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: extractionPrompt(input.textHint),
        images: input.contentType.startsWith("image/") ? [input.dataBase64] : undefined,
        stream: false,
        format: "json",
      }),
    });
    if (!response.ok) throw new ValidationError(`Extraction Ollama impossible (${response.status}).`);
    const payload = await response.json() as { response?: string };
    return parseProviderText(payload.response ?? "{}", input.fileName.replace(/\.[^.]+$/, ""));
  }
}

function providerFromEnv(): DocumentExtractionProvider {
  const provider = process.env.DOCUMENT_AI_PROVIDER || "openai";
  if (provider === "ollama") return new OllamaDocumentExtractionProvider();
  if (provider === "openai") return new OpenAiDocumentExtractionProvider();
  throw new ValidationError("DOCUMENT_AI_PROVIDER doit valoir openai ou ollama.");
}

export async function previewEquipmentDocument(input: {
  fileName: string;
  contentType: string;
  dataBase64: string;
}): Promise<EquipmentImportPreview> {
  if (!ANALYZABLE_TYPES.has(input.contentType)) {
    throw new ValidationError("Format non supporte pour l'analyse automatique (PDF ou image).");
  }
  const buffer = Buffer.from(input.dataBase64, "base64");
  if (buffer.byteLength > 20 * 1024 * 1024) {
    throw new ValidationError("Le fichier ne doit pas depasser 20 Mo");
  }

  let textHint: string | undefined;
  if (input.contentType === "application/pdf") {
    const local = extractLocalPdfPreview(input.fileName, buffer);
    if (local && local.lines.length > 0) return local;
    textHint = buffer.toString("latin1").replace(/[^\x20-\x7EÀ-ÿ\r\n,.;:%€-]/g, " ").slice(0, 6000);
  }

  const result = await providerFromEnv().extract({ ...input, textHint });
  if (result.lines.length === 0) result.warnings.push("Aucune ligne materiel fiable detectee.");
  return result;
}
