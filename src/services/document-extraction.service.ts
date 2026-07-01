import { ValidationError } from "../lib/errors.js";

export type DocumentType = "quote" | "invoice" | "unknown";

export type ExtractedEquipmentLine = {
  name: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  amountInputMode: "HT" | "TTC";
  vatRateBasisPoints: number;
  rentalCoef: number;
  notes?: string | null;
  confidence?: number;
};

export type EquipmentImportCandidate = {
  id: string;
  name: string;
  score: number;
};

export type EquipmentImportSupplierCandidate = {
  id: string;
  fullName: string;
  score: number;
};

export type EquipmentImportPreview = {
  label: string;
  documentType: DocumentType;
  supplierName: string | null;
  supplierCandidates?: EquipmentImportSupplierCandidate[];
  amountInputMode: "HT" | "TTC";
  vatRateBasisPoints: number;
  discountCents: number | null;
  discountPct: number | null;
  lines: Array<ExtractedEquipmentLine & { equipmentCandidates?: EquipmentImportCandidate[] }>;
  warnings: string[];
};

export interface DocumentExtractionProvider {
  extract(input: {
    fileName: string;
    contentType: string;
    dataBase64: string;
  }): Promise<EquipmentImportPreview>;
}

const ANALYZABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

function parseProviderJson(value: unknown, fallbackLabel: string): EquipmentImportPreview {
  const parsed = value as Partial<EquipmentImportPreview>;
  const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
  const parsedAmountInputMode: "HT" | "TTC" = parsed.amountInputMode === "HT" ? "HT" : "TTC";
  return {
    label: typeof parsed.label === "string" && parsed.label.trim() ? parsed.label.trim() : fallbackLabel,
    documentType: parsed.documentType === "quote" || parsed.documentType === "invoice" ? parsed.documentType : "unknown",
    supplierName: typeof (parsed as { supplierName?: unknown }).supplierName === "string" && (parsed as { supplierName: string }).supplierName.trim()
      ? (parsed as { supplierName: string }).supplierName.trim()
      : null,
    amountInputMode: parsedAmountInputMode,
    vatRateBasisPoints: typeof parsed.vatRateBasisPoints === "number"
      ? Math.min(10000, Math.max(0, Math.round(parsed.vatRateBasisPoints)))
      : 2000,
    discountCents: typeof parsed.discountCents === "number" ? Math.max(0, Math.round(parsed.discountCents)) : null,
    discountPct: typeof parsed.discountPct === "number" ? Math.min(100, Math.max(0, parsed.discountPct)) : null,
    lines: lines.map((line) => {
      const item = line as Partial<ExtractedEquipmentLine>;
      return {
        name: String(item.name ?? "").trim(),
        category: String(item.category ?? "location").trim() || "location",
        quantity: Math.max(1, Math.round(Number(item.quantity ?? 1))),
        unitPriceCents: Math.max(0, Math.round(Number(item.unitPriceCents ?? 0))),
        amountInputMode: item.amountInputMode === "HT" ? "HT" : parsedAmountInputMode,
        vatRateBasisPoints: typeof item.vatRateBasisPoints === "number"
          ? Math.min(10000, Math.max(0, Math.round(item.vatRateBasisPoints)))
          : (typeof parsed.vatRateBasisPoints === "number"
              ? Math.min(10000, Math.max(0, Math.round(parsed.vatRateBasisPoints)))
              : 2000),
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

function extractionPrompt(input?: { contentType: string; dataBase64: string }) {
  const pdfPayload = input?.contentType === "application/pdf"
    ? `PDF base64:\n${input.dataBase64}`
    : "";
  return [
    "Extract equipment rental quote/invoice lines as strict JSON.",
    "Schema: {label:string,documentType:'quote'|'invoice'|'unknown',supplierName:string|null,amountInputMode:'HT'|'TTC',vatRateBasisPoints:number,discountCents:number|null,discountPct:number|null,lines:[{name:string,category:string,quantity:number,unitPriceCents:number,amountInputMode:'HT'|'TTC',vatRateBasisPoints:number,rentalCoef:number,notes:string|null,confidence:number}],warnings:string[]}.",
    "Use cents for money. Detect supplierName when visible. Detect whether document line prices are HT or TTC; most French supplier quotes/invoices list TTC totals, so choose TTC unless clearly marked HT. Use VAT basis points (20% = 2000). Do not create catalog matches. Invoices are treated as equipment quotes.",
    pdfPayload,
  ].filter(Boolean).join("\n\n");
}

class OpenAiDocumentExtractionProvider implements DocumentExtractionProvider {
  async extract(input: { fileName: string; contentType: string; dataBase64: string }) {
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
            { type: "input_text", text: extractionPrompt() },
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
  async extract(input: { fileName: string; contentType: string; dataBase64: string }) {
    const model = process.env.OLLAMA_MODEL || "llava";
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: extractionPrompt(input),
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
  const provider = process.env.DOCUMENT_AI_PROVIDER || "ollama";
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

  const result = await providerFromEnv().extract(input);
  if (result.lines.length === 0) result.warnings.push("Aucune ligne materiel fiable detectee.");
  return result;
}
