import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();

describe("event list budget summary", () => {
  it("matches the budget page forecast for tickets sold, without the bar estimate", async () => {
    const { authorization } = await seedAdminSession();
    const { event } = await seedEventContext(authorization);
    await prisma.event.update({ where: { id: event.id }, data: { avgBasketCents: 500 } });
    await prisma.ticketTier.create({
      data: { eventId: event.id, name: "Prévente", organizerRevenueCents: 1000, publicPriceCents: 1200, quantity: 100, sold: 30 },
    });
    await prisma.income.create({ data: { eventId: event.id, label: "Sponsor", amountCents: 5000, category: "sponsor" } });
    await prisma.expense.create({ data: { eventId: event.id, label: "Cachet", amountCents: 40000, category: "artistes", phase: "FORECAST" } });
    await prisma.shoppingItem.createMany({
      data: [
        { eventId: event.id, name: "Gobelets", quantity: 1, category: "bar", estimatedCents: 2000 },
        { eventId: event.id, name: "Glaçons", quantity: 1, category: "bar", estimatedCents: 9999, bought: true },
      ],
    });

    const events = json<Array<{ id: string; budgetSummary: { totalExpensesCents: number; resultCents: number; remainingToBreakEvenCents: number; breakEvenStatus: string } }>>(
      await request("GET", "/api/events", authorization),
    );
    const summary = events.find((entry) => entry.id === event.id)?.budgetSummary;

    // Cachet + planned shopping + SACEM estimate (11.5 % of 300 € of ticketing); the average basket is ignored.
    assert.equal(summary?.totalExpensesCents, 40000 + 2000 + 3450);
    assert.equal(summary?.resultCents, 30000 + 5000 - 45450);
    assert.equal(summary?.remainingToBreakEvenCents, 10450);
    assert.equal(summary?.breakEvenStatus, "REACHABLE");
  });
});
