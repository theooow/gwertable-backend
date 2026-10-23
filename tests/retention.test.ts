import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
import { purgeVolunteerData } from "../src/workers/retention-worker.js";
setupTestApp();

const YEAR_MS = 365 * 24 * 3600_000;

describe("retention", () => {
  it("purges volunteer applications after a year and contracts after their retention", async () => {
    const { authorization, user } = await seedAdminSession();
    const { event, person } = await seedEventContext(authorization);
    const now = new Date("2030-06-01T00:00:00Z");
    await prisma.event.update({ where: { id: event.id }, data: { startsAt: new Date(now.getTime() - 2 * YEAR_MS), endsAt: null } });
    const bob = await prisma.person.create({ data: { workspaceId: event.workspaceId, fullName: "Bob", tags: [] } });
    const [signed, plain] = await Promise.all([person, bob].map((p) => prisma.volunteerApplication.create({ data: { eventId: event.id, personId: p.id, fullName: p.fullName, dietary: "VEGAN" } })));
    await prisma.eventParticipant.create({ data: { eventId: event.id, personId: bob.id, roles: ["VOLUNTEER"], dietary: "VEGAN" } });
    await prisma.volunteerContract.create({ data: {
      workspaceId: event.workspaceId, eventId: event.id, personId: person.id, applicationId: signed!.id, title: "Contrat", eventName: "Fête",
      signerName: person.fullName, signerEmail: "signer@example.test", content: "…", documentHash: "a".repeat(64), sourcePdf: Buffer.from("%PDF"),
      createdBy: user.id, tokenHash: "b".repeat(64), expiresAt: now, snapshot: { retentionYears: 3 },
    } });

    assert.deepEqual(await purgeVolunteerData(prisma, now), { contracts: 0, applications: 1 });
    assert.equal(await prisma.volunteerApplication.count({ where: { id: plain!.id } }), 0);
    assert.equal((await prisma.eventParticipant.findFirstOrThrow({ where: { personId: bob.id } })).dietary, null);
    assert.equal(await prisma.person.count({ where: { id: bob.id } }), 1);

    assert.deepEqual(await purgeVolunteerData(prisma, new Date(now.getTime() + 1.5 * YEAR_MS)), { contracts: 1, applications: 1 });
    assert.equal(await prisma.volunteerApplication.count(), 0);
  });
});
