import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

function base64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("equipment document import", () => {
  it("uses OpenAI by default for previews", async () => {
    const previousProvider = process.env.DOCUMENT_AI_PROVIDER;
    const previousKey = process.env.OPENAI_API_KEY;
    const previousModel = process.env.OPENAI_MODEL;
    const previousFetch = globalThis.fetch;
    process.env.DOCUMENT_AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-test";

    let requestUrl = "";
    let authHeader = "";
    let requestBody: { model: string; input: Array<{ content: Array<{ type: string; text?: string; file_data?: string }> }> } | null = null;
    globalThis.fetch = (async (url, init) => {
      requestUrl = String(url);
      authHeader = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          label: "Devis SoundCo",
          documentType: "quote",
          supplierName: "SoundCo",
          discountCents: null,
          discountPct: 5,
          lines: [{
            name: "Projecteur LED",
            category: "son",
            quantity: 2,
            unitPriceCents: 1000,
            rentalCoef: 1,
            notes: null,
            confidence: 0.9,
          }],
          warnings: [],
        }),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const { authorization, user } = await seedAdminSession();
    await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PLATINIUM" } });
    const { event } = await seedEventContext(authorization);
    const supplier = await prisma.person.create({
      data: { workspaceId: user.defaultWorkspaceId!, fullName: "SoundCo", tags: [], contactType: "SUPPLIER" },
    });
    const item = await prisma.equipmentItem.create({
      data: {
        workspaceId: user.defaultWorkspaceId!,
        name: "Projecteur LED",
        category: "son",
        ownership: "RENTED",
        supplierId: supplier.id,
        quantity: 4,
      },
    });
    const imageData = base64("fake image bytes");

    const response = await request("POST", `/api/events/${event.id}/equipment/import-preview`, authorization, {
      fileName: "devis-soundco.png",
      contentType: "image/png",
      data: imageData,
    });

    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) delete process.env.DOCUMENT_AI_PROVIDER;
    else process.env.DOCUMENT_AI_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;

    assert.equal(response.statusCode, 200);
    assert.ok(requestBody);
    assert.equal(requestUrl, "https://api.openai.com/v1/responses");
    assert.equal(authHeader, "Bearer test-openai-key");
    const openAiRequest = requestBody as { model: string; input: Array<{ content: Array<{ type: string; text?: string; file_data?: string }> }> };
    assert.equal(openAiRequest.model, "gpt-test");
    assert.match(openAiRequest.input[0]?.content[0]?.text ?? "", /Extract equipment rental quote/);
    assert.equal(openAiRequest.input[0]?.content[1]?.file_data, `data:image/png;base64,${imageData}`);
    const preview = json<{
      label: string;
      documentType: string;
      discountPct: number | null;
      supplierCandidates?: Array<{ id: string; fullName: string }>;
      lines: Array<{ name: string; quantity: number; unitPriceCents: number; equipmentCandidates?: Array<{ id: string; name: string }> }>;
    }>(response);
    assert.equal(preview.label, "Devis SoundCo");
    assert.equal(preview.documentType, "quote");
    assert.equal(preview.discountPct, 5);
    assert.equal(preview.supplierCandidates?.[0]?.id, supplier.id);
    assert.equal(preview.lines.length, 1);
    assert.equal(preview.lines[0]?.name, "Projecteur LED");
    assert.equal(preview.lines[0]?.quantity, 2);
    assert.equal(preview.lines[0]?.unitPriceCents, 1000);
    assert.equal(preview.lines[0]?.equipmentCandidates?.[0]?.id, item.id);
  });

  it("returns a clear error when an AI provider is required but not configured", async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.DOCUMENT_AI_PROVIDER = "openai";

    const { authorization, user } = await seedAdminSession();
    await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PLATINIUM" } });
    const { event } = await seedEventContext(authorization);

    const response = await request("POST", `/api/events/${event.id}/equipment/import-preview`, authorization, {
      fileName: "scan.png",
      contentType: "image/png",
      data: base64("not really an image but enough for request validation"),
    });

    if (previousKey) process.env.OPENAI_API_KEY = previousKey;

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /OPENAI_API_KEY/);
  });

  it("requires equipment.write permission for preview", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);
    const viewer = await prisma.user.create({
      data: {
        email: "viewer@abregi.test",
        role: "VIEWER",
        defaultWorkspaceId: workspace.id,
        workspaceMemberships: { create: { workspaceId: workspace.id, role: "VIEWER" } },
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: "viewer-session",
        userId: viewer.id,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const response = await request("POST", `/api/events/${event.id}/equipment/import-preview`, `Bearer ${session.sessionToken}`, {
      fileName: "devis.pdf",
      contentType: "application/pdf",
      data: base64("Devis\nProjecteur 1 10.00"),
    });

    assert.equal(response.statusCode, 403);
  });

  it("blocks AI preview on the beta test plan", async () => {
    const { authorization } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);

    const response = await request("POST", `/api/events/${event.id}/equipment/import-preview`, authorization, {
      fileName: "scan.png",
      contentType: "image/png",
      data: base64("fake image bytes"),
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.body, /plan Platinium/);
  });

  it("confirms an import as one quote with one-off usages and synced budget expense", async () => {
    const { authorization } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);

    const response = await request("POST", `/api/events/${event.id}/equipment/import-confirm`, authorization, {
      fileName: "facture-soundco.pdf",
      contentType: "application/pdf",
      data: base64("Facture SoundCo\nProjecteur LED 2 10,00\nRemise 5%"),
      label: "Facture SoundCo",
      documentType: "invoice",
      discountCents: null,
      discountPct: 5,
      createSupplierName: "SoundCo",
      lines: [
        {
          name: "Projecteur LED",
          category: "son",
          quantity: 2,
          unitPriceCents: 1000,
          createCatalogItem: true,
          rentalCoef: 1,
          notes: "ligne editee",
        },
      ],
    });

    assert.equal(response.statusCode, 201);
    const quote = json<{ id: string; label: string; discountPct: string | number | null; fileUrl: string | null; usages: unknown[] }>(response);
    assert.equal(quote.label, "Facture SoundCo");
    assert.ok(quote.fileUrl?.startsWith("/api/uploads/equipment-quotes/"));
    assert.equal(quote.usages.length, 1);

    const usages = await prisma.equipmentUsage.findMany({ where: { quoteId: quote.id } });
    assert.equal(usages.length, 1);
    assert.ok(usages[0]?.itemId);
    assert.equal(usages[0]?.name, null);

    const createdItem = await prisma.equipmentItem.findUnique({ where: { id: usages[0]!.itemId! }, include: { supplier: true } });
    assert.equal(createdItem?.name, "Projecteur LED");
    assert.equal(createdItem?.supplier?.fullName, "SoundCo");

    const memories = await prisma.equipmentImportMatchMemory.findMany({ where: { workspaceId: createdItem!.workspaceId } });
    assert.ok(memories.some((memory) => memory.kind === "equipment" && memory.itemId === createdItem?.id));
    assert.ok(memories.some((memory) => memory.kind === "supplier" && memory.supplierId === createdItem?.supplierId));

    const expenses = await prisma.expense.findMany({ where: { eventId: event.id, isEquipmentSync: true } });
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0]?.label, "Facture SoundCo");
    assert.equal(expenses[0]?.amountCents, 1900);
    assert.equal(expenses[0]?.equipmentQuoteId, quote.id);
  });
});
