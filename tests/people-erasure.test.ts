import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { request, json, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
setupTestApp();
describe("contact erasure", () => {
  it("deletes a contact, its history and activity while keeping budget amounts", async () => {
    const { authorization } = await seedAdminSession();
    const { event, person } = await seedEventContext(authorization);
    const participant = await prisma.eventParticipant.create({ data: { eventId: event.id, personId: person.id, roles: ["ARTIST"] } });
    const expense = await prisma.expense.create({ data: { eventId: event.id, label: "Cachet", category: "artistes", amountCents: 50000, paidById: person.id, sourceParticipantId: participant.id } });
    await prisma.personHistoryNote.create({ data: { personId: person.id, kind: "CALL" } });
    await request("POST", `/api/people/${person.id}/archive`, authorization);
    const response = await request("DELETE", `/api/people/${person.id}`, authorization);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(json(response), { mode: "deleted" });
    assert.equal(await prisma.person.count({ where: { id: person.id } }), 0);
    assert.equal(await prisma.activityEntry.count({ where: { entityType: "PERSON", entityId: person.id } }), 0);
    const kept = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(kept.amountCents, 50000); assert.equal(kept.paidById, null); assert.equal(kept.sourceParticipantId, null);
    assert.equal((await request("DELETE", `/api/people/${person.id}`, authorization)).statusCode, 404);
  });
  it("anonymizes a contact who must stay linked to an account and hides it from lists", async () => {
    const { authorization, user } = await seedAdminSession();
    const linked = await prisma.person.findFirstOrThrow({ where: { user: { id: user.id } } }).catch(async () => {
      const created = await prisma.person.create({ data: { workspaceId: (await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } })).workspaceId, fullName: "Moi", email: "me@example.test", tags: [] } });
      await prisma.user.update({ where: { id: user.id }, data: { personId: created.id } });
      return created;
    });
    const response = await request("DELETE", `/api/people/${linked.id}`, authorization);
    assert.deepEqual(json(response), { mode: "anonymized" });
    const anonymized = await prisma.person.findUniqueOrThrow({ where: { id: linked.id } });
    assert.equal(anonymized.fullName, "Contact supprimé"); assert.equal(anonymized.email, null); assert.ok(anonymized.anonymizedAt);
    const list = json<{ id: string }[] | { people: { id: string }[] }>(await request("GET", "/api/people?includeArchived=true", authorization));
    const ids = (Array.isArray(list) ? list : list.people).map((p) => p.id);
    assert.equal(ids.includes(linked.id), false);
  });
});
