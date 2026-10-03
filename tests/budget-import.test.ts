import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

function base64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function withOpenAiResponse<T>(output: unknown, run: (prompts: string[]) => Promise<T>) {
  const previous = {
    provider: process.env.DOCUMENT_AI_PROVIDER,
    key: process.env.OPENAI_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  const prompts: string[] = [];
  process.env.DOCUMENT_AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { input: Array<{ content: Array<{ text?: string }> }> };
    prompts.push(body.input[0]?.content[0]?.text ?? "");
    return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 });
  }) as typeof fetch;
  try {
    return await run(prompts);
  } finally {
    globalThis.fetch = previousFetch;
    if (previous.provider === undefined) delete process.env.DOCUMENT_AI_PROVIDER;
    else process.env.DOCUMENT_AI_PROVIDER = previous.provider;
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.key;
  }
}

type BudgetPreview = {
  label: string;
  documentType: string;
  counterpartyName: string | null;
  documentDate: string | null;
  totalCents: number;
  lines: Array<{ label: string; category: string; amountCents: number; vatRateBasisPoints: number }>;
};

describe("budget document import", () => {
  it("previews expense lines and normalizes unknown categories", async () => {
    const { authorization, user } = await seedAdminSession();
    await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PLATINIUM" } });
    const { event } = await seedEventContext(authorization);

    await withOpenAiResponse({
      label: "Facture Traiteur",
      documentType: "invoice",
      counterpartyName: "Traiteur & Co",
      documentDate: "2026-09-12",
      amountInputMode: "TTC",
      vatRateBasisPoints: 1000,
      totalCents: 45000,
      lines: [
        { label: "Buffet", category: "nourriture", amountCents: 40000, confidence: 0.9 },
        { label: "Livraison", category: "frais", amountCents: 5000 },
      ],
      warnings: [],
    }, async (prompts) => {
      const response = await request("POST", `/api/events/${event.id}/expenses/import-preview`, authorization, {
        fileName: "facture.png",
        contentType: "image/png",
        data: base64("fake image"),
      });

      assert.equal(response.statusCode, 200);
      assert.match(prompts[0] ?? "", /budget expense lines/);
      const preview = json<BudgetPreview>(response);
      assert.equal(preview.label, "Facture Traiteur");
      assert.equal(preview.documentType, "invoice");
      assert.equal(preview.counterpartyName, "Traiteur & Co");
      assert.equal(preview.documentDate, "2026-09-12");
      assert.equal(preview.totalCents, 45000);
      assert.deepEqual(preview.lines.map((line) => [line.label, line.category, line.amountCents, line.vatRateBasisPoints]), [
        ["Buffet", "nourriture", 40000, 1000],
        ["Livraison", "autre", 5000, 1000],
      ]);
    });
  });

  it("previews income lines with income categories", async () => {
    const { authorization, user } = await seedAdminSession();
    await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PLATINIUM" } });
    const { event } = await seedEventContext(authorization);

    await withOpenAiResponse({
      label: "Devis partenariat",
      documentType: "quote",
      counterpartyName: "Brasserie du Nord",
      lines: [{ label: "Sponsoring soirée", category: "sponsor", amountCents: 120000 }],
    }, async (prompts) => {
      const response = await request("POST", `/api/events/${event.id}/incomes/import-preview`, authorization, {
        fileName: "devis.pdf",
        contentType: "application/pdf",
        data: base64("%PDF fake"),
      });

      assert.equal(response.statusCode, 200);
      assert.match(prompts[0] ?? "", /budget income lines/);
      const preview = json<BudgetPreview>(response);
      assert.equal(preview.totalCents, 120000);
      assert.equal(preview.lines[0]?.category, "sponsor");
    });
  });

  it("blocks AI preview on the beta test plan", async () => {
    const { authorization } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);

    const response = await request("POST", `/api/events/${event.id}/incomes/import-preview`, authorization, {
      fileName: "scan.png",
      contentType: "image/png",
      data: base64("fake image bytes"),
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.body, /plan Platinium/);
  });

  it("confirms expenses with the stored document as receipt", async () => {
    const { authorization } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);

    const response = await request("POST", `/api/events/${event.id}/expenses/import-confirm`, authorization, {
      fileName: "facture.pdf",
      contentType: "application/pdf",
      data: base64("%PDF fake"),
      lines: [
        { label: "Buffet", amount: "400", phase: "FORECAST", amountInputMode: "TTC", vatRateBasisPoints: 1000, category: "nourriture" },
        { label: "Livraison", amount: "50", phase: "FORECAST", amountInputMode: "TTC", vatRateBasisPoints: 1000, category: "transport", notes: "Traiteur & Co" },
      ],
    });

    assert.equal(response.statusCode, 201);
    const expenses = json<Array<{ label: string; receiptUrl: string | null; phase: string }>>(response);
    assert.equal(expenses.length, 2);
    assert.ok(expenses.every((expense) => expense.receiptUrl?.startsWith("/api/uploads/receipts/")));
    assert.equal(expenses[0]?.receiptUrl, expenses[1]?.receiptUrl);
    assert.equal(await prisma.expense.count({ where: { eventId: event.id, phase: "FORECAST" } }), 2);
  });

  it("confirms incomes", async () => {
    const { authorization } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);

    const response = await request("POST", `/api/events/${event.id}/incomes/import-confirm`, authorization, {
      lines: [{ label: "Sponsoring soirée", amount: "1200", category: "sponsor" }],
    });

    assert.equal(response.statusCode, 201);
    const incomes = await prisma.income.findMany({ where: { eventId: event.id } });
    assert.equal(incomes.length, 1);
    assert.equal(incomes[0]?.amountCents, 120000);
  });
});
