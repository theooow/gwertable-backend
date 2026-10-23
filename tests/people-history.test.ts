import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
setupTestApp();
describe("contact history", () => {
  it("records typed interactions and rejects free text", async () => {
    const { authorization } = await seedAdminSession();
    const { person } = await seedEventContext(authorization);
    const created = await request("POST", `/api/people/${person.id}/history`, authorization, { kind: "CALL", eventDate: "2026-10-01T10:00:00Z" });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal((await prisma.personHistoryNote.findFirstOrThrow({ where: { personId: person.id } })).kind, "CALL");
    assert.equal((await request("POST", `/api/people/${person.id}/history`, authorization, { body: "Allergique, en arrêt maladie" })).statusCode, 400);
    assert.equal((await request("POST", `/api/people/${person.id}/history`, authorization, { kind: "GOSSIP" })).statusCode, 400);
    assert.equal(await prisma.personHistoryNote.count(), 1);
  });
});
