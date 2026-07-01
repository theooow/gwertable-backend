import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

describe("equipment vat", () => {
  it("keeps vat settings on library items and syncs the related expense", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);
    await prisma.event.update({
      where: { id: event.id },
      data: { vatMode: "ASSUJETTI" },
    });

    const item = await prisma.equipmentItem.create({
      data: {
        workspaceId: workspace.id,
        name: "Console",
        category: "son",
        ownership: "OWNED",
        unitPriceCents: 1000,
        amountInputMode: "HT",
        vatRateBasisPoints: 1000,
        rentalCoef: 1,
        quantity: 4,
      },
    });

    const response = await request("POST", `/api/events/${event.id}/equipment`, authorization, {
      kind: "library",
      itemId: item.id,
      quantity: 2,
    });

    assert.equal(response.statusCode, 201);

    const usage = json<{
      itemId: string | null;
      quantity: number;
      unitPriceCents: number;
      amountInputMode: "HT" | "TTC";
      vatRateBasisPoints: number;
      rentalCoef: string | number;
    }>(response);

    assert.equal(usage.itemId, item.id);
    assert.equal(usage.quantity, 2);
    assert.equal(usage.unitPriceCents, 1000);
    assert.equal(usage.amountInputMode, "HT");
    assert.equal(usage.vatRateBasisPoints, 1000);

    const expenses = await prisma.expense.findMany({ where: { eventId: event.id, isEquipmentSync: true } });
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0]?.amountCents, 2200);
    assert.equal(expenses[0]?.amountHtCents, 2000);
    assert.equal(expenses[0]?.amountVatCents, 200);
    assert.equal(expenses[0]?.amountTtcCents, 2200);
    assert.equal(expenses[0]?.amountInputMode, "HT");
    assert.equal(expenses[0]?.vatRateBasisPoints, 1000);
  });

  it("keeps ht and ttc amounts for equipment expenses on non-vat events", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);

    const item = await prisma.equipmentItem.create({
      data: {
        workspaceId: workspace.id,
        name: "Podium",
        category: "structure",
        ownership: "OWNED",
        unitPriceCents: 1000,
        amountInputMode: "HT",
        vatRateBasisPoints: 2000,
        rentalCoef: 1,
        quantity: 1,
      },
    });

    const response = await request("POST", `/api/events/${event.id}/equipment`, authorization, {
      kind: "library",
      itemId: item.id,
      quantity: 1,
    });

    assert.equal(response.statusCode, 201);

    const expenses = await prisma.expense.findMany({ where: { eventId: event.id, isEquipmentSync: true } });
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0]?.amountCents, 1200);
    assert.equal(expenses[0]?.amountHtCents, 1000);
    assert.equal(expenses[0]?.amountVatCents, 200);
    assert.equal(expenses[0]?.amountTtcCents, 1200);
    assert.equal(expenses[0]?.amountInputMode, "HT");
    assert.equal(expenses[0]?.vatRateBasisPoints, 2000);
  });
});
