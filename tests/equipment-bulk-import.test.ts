import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

describe("equipment bulk import", () => {
  it("imports multiple library items and creates quotes by supplier", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);

    const [soundSupplier, lightSupplier] = await Promise.all([
      prisma.person.create({
        data: { workspaceId: workspace.id, fullName: "SoundCo", tags: [], contactType: "SUPPLIER" },
      }),
      prisma.person.create({
        data: { workspaceId: workspace.id, fullName: "LightCo", tags: [], contactType: "SUPPLIER" },
      }),
    ]);

    const [speaker, projector, cable] = await Promise.all([
      prisma.equipmentItem.create({
        data: {
          workspaceId: workspace.id,
          name: "Speaker",
          category: "son",
          ownership: "RENTED",
          supplierId: soundSupplier.id,
          unitPriceCents: 10000,
          rentalCoef: 0.4,
          quantity: 6,
        },
      }),
      prisma.equipmentItem.create({
        data: {
          workspaceId: workspace.id,
          name: "Projector",
          category: "lumiere",
          ownership: "RENTED",
          supplierId: lightSupplier.id,
          unitPriceCents: 20000,
          rentalCoef: 0.5,
          quantity: 4,
        },
      }),
      prisma.equipmentItem.create({
        data: {
          workspaceId: workspace.id,
          name: "Cable",
          category: "son",
          ownership: "OWNED",
          unitPriceCents: 500,
          rentalCoef: 1,
          quantity: 20,
        },
      }),
    ]);

    const response = await request("POST", `/api/events/${event.id}/equipment/bulk-import`, authorization, {
      createQuotesBySupplier: true,
      lines: [
        { itemId: speaker.id, quantity: 2, unitPriceCents: 9000, rentalCoef: 0.5, notes: "pack facade" },
        { itemId: projector.id, quantity: 1 },
        { itemId: cable.id, quantity: 8 },
      ],
    });

    assert.equal(response.statusCode, 201);
    const body = json<{
      usages: Array<{ itemId: string; quantity: number; quoteId: string | null; unitPriceCents: number; notes: string | null }>;
      quotes: Array<{ id: string; label: string }>;
    }>(response);

    assert.equal(body.usages.length, 3);
    assert.equal(body.quotes.length, 2);
    assert.deepEqual(body.quotes.map((quote) => quote.label).sort(), ["Devis LightCo", "Devis SoundCo"]);

    const speakerUsage = body.usages.find((usage) => usage.itemId === speaker.id);
    assert.equal(speakerUsage?.quantity, 2);
    assert.equal(speakerUsage?.unitPriceCents, 9000);
    assert.equal(speakerUsage?.notes, "pack facade");
    assert.ok(speakerUsage?.quoteId);

    const cableUsage = body.usages.find((usage) => usage.itemId === cable.id);
    assert.equal(cableUsage?.quoteId, null);

    const expenses = await prisma.expense.findMany({ where: { eventId: event.id, isEquipmentSync: true } });
    assert.equal(expenses.length, 3);
  });

  it("rejects duplicate items before creating anything", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);
    const item = await prisma.equipmentItem.create({
      data: {
        workspaceId: workspace.id,
        name: "Console",
        category: "son",
        ownership: "OWNED",
        quantity: 1,
      },
    });

    const response = await request("POST", `/api/events/${event.id}/equipment/bulk-import`, authorization, {
      createQuotesBySupplier: false,
      lines: [
        { itemId: item.id, quantity: 1 },
        { itemId: item.id, quantity: 1 },
      ],
    });

    assert.equal(response.statusCode, 409);
    const usages = await prisma.equipmentUsage.findMany({ where: { eventId: event.id } });
    assert.equal(usages.length, 0);
  });
});
