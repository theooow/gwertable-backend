import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
import { deleteInactiveAccounts, purgeVolunteerData, warnInactiveAccounts } from "../src/workers/retention-worker.js";
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

  it("warns then deletes inactive accounts, sparing paying customers and keeping shared workspaces", async () => {
    const now = new Date("2030-06-01T00:00:00Z");
    const longAgo = new Date(now.getTime() - 3 * YEAR_MS - 1000);
    const account = async (email: string) => {
      const workspace = await prisma.workspace.create({ data: { name: email } });
      return prisma.user.create({ data: { email, workspaceMemberships: { create: { workspaceId: workspace.id, role: "ADMIN" } } } });
    };
    const [solo, paying, soon, admin] = await Promise.all(["solo", "paying", "soon", "admin"].map((name) => account(`${name}@example.test`)));
    const soloWorkspace = (await prisma.workspaceMember.findFirstOrThrow({ where: { userId: solo.id } })).workspaceId;
    const sharedWorkspace = (await prisma.workspaceMember.findFirstOrThrow({ where: { userId: admin.id } })).workspaceId;
    const colleague = await prisma.user.create({ data: { email: "colleague@example.test", lastSeenAt: now, workspaceMemberships: { create: { workspaceId: sharedWorkspace, role: "ORGANIZER" } } } });
    const warned = new Date(now.getTime() - 31 * 24 * 3600_000);
    await prisma.user.update({ where: { id: solo.id }, data: { lastSeenAt: longAgo, inactivityWarnedAt: warned } });
    await prisma.user.update({ where: { id: admin.id }, data: { lastSeenAt: longAgo, inactivityWarnedAt: warned } });
    await prisma.user.update({ where: { id: paying.id }, data: { lastSeenAt: longAgo, subscriptionStatus: "active" } });
    await prisma.user.update({ where: { id: soon.id }, data: { lastSeenAt: new Date(now.getTime() - 3 * YEAR_MS + 10 * 24 * 3600_000) } });

    assert.equal(await warnInactiveAccounts(prisma, undefined, now), 1);
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: soon.id } })).inactivityWarnedAt);
    assert.equal(await deleteInactiveAccounts(prisma, now), 2);

    assert.deepEqual((await prisma.user.findMany({ where: { id: { in: [solo.id, admin.id, paying.id, soon.id] } }, select: { id: true } })).map((u) => u.id).sort(), [paying.id, soon.id].sort());
    assert.ok((await prisma.workspace.findUniqueOrThrow({ where: { id: soloWorkspace } })).anonymizedAt);
    assert.equal((await prisma.workspace.findUniqueOrThrow({ where: { id: sharedWorkspace } })).anonymizedAt, null);
    assert.equal((await prisma.workspaceMember.findFirstOrThrow({ where: { userId: colleague.id } })).role, "ADMIN");
  });
});
