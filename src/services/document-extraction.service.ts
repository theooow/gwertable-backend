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

type DocumentExtractionInput = {
  fileName: string;
  contentType: string;
  dataBase64: string;
};

export interface DocumentExtractionProvider {
  extractText(input: DocumentExtractionInput, instructions: string): Promise<string>;
}

const ANALYZABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

function looksLikeProductReference(value: string) {
  const clean = value.trim();
  if (!clean || clean.includes(" ")) return false;
  return /^[A-Z0-9._/-]{3,18}$/.test(clean) && /\d/.test(clean);
}

function normalizeExtractedNameAndNotes(name: string, notes?: string | null) {
  const cleanName = name.trim();
  const cleanNotes = notes?.trim() || null;
  if (
    cleanNotes &&
    looksLikeProductReference(cleanName) &&
    cleanNotes.length > cleanName.length + 6 &&
    cleanNotes.split(/\s+/).length >= 2
  ) {
    return { name: cleanNotes, notes: `Ref: ${cleanName}` };
  }
  return { name: cleanName, notes: cleanNotes };
}

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
      const normalized = normalizeExtractedNameAndNotes(String(item.name ?? ""), item.notes ? String(item.notes) : null);
      return {
        name: normalized.name,
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
        notes: normalized.notes,
        confidence: typeof item.confidence === "number" ? Math.min(1, Math.max(0, item.confidence)) : undefined,
      };
    }).filter((line) => line.name),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
  };
}

function parseProviderText<T>(text: string, parse: (value: unknown) => T): T {
  try {
    return parse(JSON.parse(text));
  } catch {
    throw new ValidationError("Le provider d'extraction n'a pas retourne un JSON valide.");
  }
}

function fallbackLabelFor(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function openAiOutputText(payload: unknown) {
  const response = payload as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  if (response.output_text) return response.output_text;
  return response.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("") ?? "";
}

function withPdfPayload(instructions: string, input: DocumentExtractionInput) {
  return input.contentType === "application/pdf"
    ? `${instructions}\n\nPDF base64:\n${input.dataBase64}`
    : instructions;
}

function equipmentExtractionPrompt() {
  return [
    "Extract equipment rental quote/invoice lines as strict JSON.",
    "Schema: {label:string,documentType:'quote'|'invoice'|'unknown',supplierName:string|null,amountInputMode:'HT'|'TTC',vatRateBasisPoints:number,discountCents:number|null,discountPct:number|null,lines:[{name:string,category:string,quantity:number,unitPriceCents:number,amountInputMode:'HT'|'TTC',vatRateBasisPoints:number,rentalCoef:number,notes:string|null,confidence:number}],warnings:string[]}.",
    "For each line, put the human-readable product description in name. If the document has a short reference/code and a longer designation, put the longer designation in name and put the reference/code in notes.",
    "Use cents for money. Detect supplierName when visible. Detect whether document line prices are HT or TTC; most French supplier quotes/invoices list TTC totals, so choose TTC unless clearly marked HT. Use VAT basis points (20% = 2000). Do not create catalog matches. Invoices are treated as equipment quotes.",
  ].join("\n\n");
}

class OpenAiDocumentExtractionProvider implements DocumentExtractionProvider {
  async extractText(input: DocumentExtractionInput, instructions: string) {
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
            { type: "input_text", text: instructions },
            { type: "input_file", filename: input.fileName, file_data: `data:${input.contentType};base64,${input.dataBase64}` },
          ],
        }],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!response.ok) throw new ValidationError(`Extraction OpenAI impossible (${response.status}).`);
    return openAiOutputText(await response.json());
  }
}

class OllamaDocumentExtractionProvider implements DocumentExtractionProvider {
  async extractText(input: DocumentExtractionInput, instructions: string) {
    const model = process.env.OLLAMA_MODEL || "llava";
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: withPdfPayload(instructions, input),
        images: input.contentType.startsWith("image/") ? [input.dataBase64] : undefined,
        stream: false,
        format: "json",
      }),
    });
    if (!response.ok) throw new ValidationError(`Extraction Ollama impossible (${response.status}).`);
    const payload = await response.json() as { response?: string };
    return payload.response ?? "{}";
  }
}

function providerFromEnv(): DocumentExtractionProvider {
  const provider = process.env.DOCUMENT_AI_PROVIDER || "ollama";
  if (provider === "ollama") return new OllamaDocumentExtractionProvider();
  if (provider === "openai") return new OpenAiDocumentExtractionProvider();
  throw new ValidationError("DOCUMENT_AI_PROVIDER doit valoir openai ou ollama.");
}

function assertAnalyzableDocument(input: DocumentExtractionInput) {
  if (!ANALYZABLE_TYPES.has(input.contentType)) {
    throw new ValidationError("Format non supporte pour l'analyse automatique (PDF ou image).");
  }
  const buffer = Buffer.from(input.dataBase64, "base64");
  if (buffer.byteLength > 20 * 1024 * 1024) {
    throw new ValidationError("Le fichier ne doit pas depasser 20 Mo");
  }
}

export async function previewEquipmentDocument(input: DocumentExtractionInput): Promise<EquipmentImportPreview> {
  assertAnalyzableDocument(input);
  const text = await providerFromEnv().extractText(input, equipmentExtractionPrompt());
  const result = parseProviderText(text, (value) => parseProviderJson(value, fallbackLabelFor(input.fileName)));
  if (result.lines.length === 0) result.warnings.push("Aucune ligne materiel fiable detectee.");
  return result;
}

export type BudgetDocumentKind = "expense" | "income";

export type ExtractedBudgetLine = {
  label: string;
  category: string;
  amountCents: number;
  amountInputMode: "HT" | "TTC";
  vatRateBasisPoints: number;
  notes: string | null;
  confidence?: number;
};

export type BudgetImportPreview = {
  label: string;
  documentType: DocumentType;
  counterpartyName: string | null;
  documentDate: string | null;
  amountInputMode: "HT" | "TTC";
  vatRateBasisPoints: number;
  totalCents: number;
  lines: ExtractedBudgetLine[];
  warnings: string[];
};

function clampVatRate(value: unknown, fallback: number) {
  return typeof value === "number" ? Math.min(10000, Math.max(0, Math.round(value))) : fallback;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseBudgetProviderJson(value: unknown, fallbackLabel: string, categories: readonly string[]): BudgetImportPreview {
  const parsed = value as Record<string, unknown>;
  const amountInputMode: "HT" | "TTC" = parsed.amountInputMode === "HT" ? "HT" : "TTC";
  const vatRateBasisPoints = clampVatRate(parsed.vatRateBasisPoints, 2000);
  const fallbackCategory = categories.includes("autre") ? "autre" : categories[0];
  const lines = (Array.isArray(parsed.lines) ? parsed.lines : []).map((line): ExtractedBudgetLine => {
    const item = line as Record<string, unknown>;
    const category = String(item.category ?? "").trim().toLowerCase();
    return {
      label: String(item.label ?? "").trim(),
      category: categories.includes(category) ? category : fallbackCategory,
      amountCents: Math.max(0, Math.round(Number(item.amountCents ?? 0)) || 0),
      amountInputMode: item.amountInputMode === "HT" ? "HT" : item.amountInputMode === "TTC" ? "TTC" : amountInputMode,
      vatRateBasisPoints: clampVatRate(item.vatRateBasisPoints, vatRateBasisPoints),
      notes: nonEmptyString(item.notes),
      confidence: typeof item.confidence === "number" ? Math.min(1, Math.max(0, item.confidence)) : undefined,
    };
  }).filter((line) => line.label);
  const documentDate = nonEmptyString(parsed.documentDate);
  const totalCents = typeof parsed.totalCents === "number" && parsed.totalCents > 0
    ? Math.round(parsed.totalCents)
    : lines.reduce((sum, line) => sum + line.amountCents, 0);
  return {
    label: nonEmptyString(parsed.label) ?? fallbackLabel,
    documentType: parsed.documentType === "quote" || parsed.documentType === "invoice" ? parsed.documentType : "unknown",
    counterpartyName: nonEmptyString(parsed.counterpartyName),
    documentDate: documentDate && /^\d{4}-\d{2}-\d{2}$/.test(documentDate) ? documentDate : null,
    amountInputMode,
    vatRateBasisPoints,
    totalCents,
    lines,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
  };
}

function budgetExtractionPrompt(kind: BudgetDocumentKind, categories: readonly string[]) {
  const context = kind === "expense"
    ? "The document is a quote, invoice or receipt received by an event organiser from a supplier. Extract the expense lines. counterpartyName is the supplier."
    : "The document is a quote or invoice issued by an event organiser to a client, partner or sponsor. Extract the revenue lines. counterpartyName is the client, partner or sponsor.";
  return [
    `Extract event budget ${kind} lines from this quote/invoice as strict JSON.`,
    context,
    "Schema: {label:string,documentType:'quote'|'invoice'|'unknown',counterpartyName:string|null,documentDate:string|null,amountInputMode:'HT'|'TTC',vatRateBasisPoints:number,totalCents:number,lines:[{label:string,category:string,amountCents:number,amountInputMode:'HT'|'TTC',vatRateBasisPoints:number,notes:string|null,confidence:number}],warnings:string[]}.",
    `label is a short title for the whole document. Each line amountCents is the line total (quantity x unit price, after line discounts). totalCents is the final document total after global discounts, expressed in amountInputMode. category must be one of: ${categories.join(", ")}.`,
    "Use cents for money. documentDate uses YYYY-MM-DD. Detect whether amounts are HT or TTC; choose TTC unless clearly marked HT. Use VAT basis points (20% = 2000). Put quantities or references in notes.",
  ].join("\n\n");
}

export async function previewBudgetDocument(
  kind: BudgetDocumentKind,
  categories: readonly string[],
  input: DocumentExtractionInput,
): Promise<BudgetImportPreview> {
  assertAnalyzableDocument(input);
  const text = await providerFromEnv().extractText(input, budgetExtractionPrompt(kind, categories));
  const result = parseProviderText(text, (value) => parseBudgetProviderJson(value, fallbackLabelFor(input.fileName), categories));
  if (result.lines.length === 0) result.warnings.push("Aucune ligne budgetaire fiable detectee.");
  return result;
}
