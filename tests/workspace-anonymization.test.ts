import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
import { localityOf } from "../src/lib/workspace-anonymization.js";
setupTestApp();

describe("workspace anonymization", () => {
  it("keeps events, genres, locality and amounts when the last member deletes the account", async () => {
    const { authorization, user } = await seedAdminSession();
    const { event, person } = await seedEventContext(authorization);
    const venue = await prisma.venue.create({ data: { workspaceId: event.workspaceId, name: "Chez Paul", address: "12 rue Oberkampf, 75011 Paris", capacity: 300, notes: "Code 1234" } });
    await prisma.event.update({ where: { id: event.id }, data: { genres: ["TECHNO"], venueId: venue.id, description: "Avec Paul" } });
    const participant = await prisma.eventParticipant.create({ data: { eventId: event.id, personId: person.id, roles: ["ARTIST"] } });
    await prisma.expense.create({ data: { eventId: event.id, label: "Cachet DJ Paul", category: "artistes", amountCents: 50000, paidById: person.id, sourceParticipantId: participant.id, notes: "IBAN FR76…" } });
    await prisma.income.create({ data: { eventId: event.id, label: "Don de Marie", category: "dons", amountCents: 2000 } });
    await prisma.ticketTier.create({ data: { eventId: event.id, name: "Early", organizerRevenueCents: 1000, publicPriceCents: 1200, quantity: 100, sold: 80 } });
    await prisma.volunteerApplication.create({ data: { eventId: event.id, personId: person.id, fullName: person.fullName, dietary: "VEGAN" } });
    await prisma.personHistoryNote.create({ data: { personId: person.id, kind: "CALL" } });

    const deleted = await request("DELETE", "/api/account", authorization, { confirm: user.email });
    assert.equal(deleted.statusCode, 200, deleted.body);

    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: event.workspaceId } });
    assert.ok(workspace.anonymizedAt); assert.equal(workspace.name, "Espace anonymisé");
    const kept = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { venue: true, expenses: true, incomes: true, ticketTiers: true } });
    assert.equal(kept.name, "Événement anonymisé"); assert.equal(kept.description, null); assert.deepEqual(kept.genres, ["TECHNO"]);
    assert.equal(kept.venue?.address, "75011 Paris"); assert.equal(kept.venue?.capacity, 300); assert.equal(kept.venue?.notes, null);
    assert.deepEqual(kept.expenses.map((e) => [e.label, e.amountCents, e.paidById, e.notes]), [["artistes", 50000, null, null]]);
    assert.deepEqual(kept.incomes.map((i) => [i.label, i.amountCents]), [["dons", 2000]]);
    assert.equal(kept.ticketTiers[0]?.sold, 80);
    assert.equal(await prisma.person.count({ where: { workspaceId: event.workspaceId } }), 0);
    assert.equal(await prisma.volunteerApplication.count(), 0);
    assert.equal(await prisma.activityEntry.count({ where: { workspaceId: event.workspaceId } }), 0);
  });

  it("reduces an address to its postcode and town", () => {
    assert.equal(localityOf("3 place du Marché 13001 Marseille"), "13001 Marseille");
    assert.equal(localityOf("Hangar sans adresse"), null);
  });
});
