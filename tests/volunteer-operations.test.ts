import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();
const startsAt = new Date(Date.now() + 7 * 86400000);
const endsAt = new Date(startsAt.getTime() + 3600000);
const availability = [{ startsAt: new Date(startsAt.getTime() - 86400000).toISOString(), endsAt: new Date(endsAt.getTime() + 86400000).toISOString() }];
async function context() {
  const { authorization, workspace } = await seedAdminSession();
  const { event, person } = await seedEventContext(authorization);
  const bob = await prisma.person.create({ data: { workspaceId: workspace.id, fullName: "Bob", email: "bob@example.test" } });
  const applications = await Promise.all([person, bob].map((p) => prisma.volunteerApplication.create({ data: { eventId: event.id, personId: p.id, fullName: p.fullName, status: "APPROVED", availability, internalNotes: "SECRET", dietary: "PRIVATE", team: "Accueil" } })));
  const base = `/api/events/${event.id}/volunteers`;
  const shift = { eventId: event.id, position: "Accueil", startsAt, endsAt, team: "Accueil" };
  return { authorization, workspace, event, person, bob, applications, base, shift };
}
async function badges(c: Awaited<ReturnType<typeof context>>) {
  return Promise.all(c.applications.map(async (a) => {
    const r = await request("POST", `${c.base}/applications/${a.id}/badge`, c.authorization, {});
    assert.equal(r.statusCode, 200, r.body);
    return json<{ accessToken: string; badgeToken: string }>(r);
  }));
}

describe("volunteer operations", () => {
  it("accepts or refuses the whole future planning atomically and exposes the reply to organizers", async () => {
    const c = await context(); const [token] = await badges(c);
    const first = await prisma.shift.create({ data: { ...c.shift, assigneeId: c.person.id } });
    const second = await prisma.shift.create({ data: { ...c.shift, startsAt: endsAt, endsAt: new Date(endsAt.getTime() + 3600000), assigneeId: c.person.id } });
    const past = await prisma.shift.create({ data: { ...c.shift, startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 3600000), assigneeId: c.person.id } });
    const path = `/api/public/volunteers/portal/${token!.accessToken}/planning`;
    const shifts = [first, second].map((s) => ({ id: s.id, version: s.confirmationVersion }));
    assert.equal((await request("PATCH", path, undefined, { accept: true, shifts: [shifts[0]] })).statusCode, 409);
    assert.equal((await request("PATCH", path, undefined, { accept: false, shifts: [shifts[0], shifts[0]] })).statusCode, 409);
    assert.equal((await request("PATCH", `/api/public/volunteers/portal/${token!.accessToken}/shifts/${first.id}`, undefined, { accept: true, version: 0 })).statusCode, 404);
    assert.equal(await prisma.shift.count({ where: { confirmationStatus: "ACCEPTED" } }), 0);
    assert.equal((await request("PATCH", path, undefined, { accept: true, shifts })).statusCode, 200);
    assert.equal(await prisma.shift.count({ where: { confirmationStatus: "ACCEPTED" } }), 2);
    const added = await prisma.shift.create({ data: { ...c.shift, startsAt: new Date(endsAt.getTime() + 3600000), endsAt: new Date(endsAt.getTime() + 7200000), assigneeId: c.person.id } });
    assert.equal((await request("PATCH", path, undefined, { accept: false, shifts })).statusCode, 409);
    assert.equal(await prisma.shift.count({ where: { assigneeId: c.person.id } }), 4);
    shifts.push({ id: added.id, version: 0 });
    assert.equal((await request("PATCH", path, undefined, { accept: false, shifts })).statusCode, 200);
    assert.equal(await prisma.shift.count({ where: { confirmationStatus: "DECLINED", assigneeId: null } }), 3);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: past.id } })).assigneeId, c.person.id);
    const overview = json<{ applications: { id: string; planningResponse: string; planningRespondedAt: string }[] }>(await request("GET", c.base, c.authorization));
    const reply = overview.applications.find((a) => a.id === c.applications[0]!.id)!;
    assert.equal(reply.planningResponse, "DECLINED"); assert.ok(reply.planningRespondedAt);
  });

  it("blocks exchanges on either locked shift and rechecks when accepting an existing request", async () => {
    const c = await context(); const tokens = await badges(c);
    const source = await prisma.shift.create({ data: { ...c.shift, assigneeId: c.person.id, swapAllowed: false } });
    const target = await prisma.shift.create({ data: { ...c.shift, startsAt: endsAt, endsAt: new Date(endsAt.getTime() + 3600000), assigneeId: c.bob.id } });
    const path = `/api/public/volunteers/portal/${tokens[0]!.accessToken}/swaps`;
    const body = { sourceShiftId: source.id, targetShiftId: target.id };
    assert.equal((await request("POST", path, undefined, body)).statusCode, 409);
    await prisma.shift.update({ where: { id: source.id }, data: { swapAllowed: true } });
    await prisma.shift.update({ where: { id: target.id }, data: { swapAllowed: false } });
    assert.equal((await request("POST", path, undefined, body)).statusCode, 409);
    const portal = json<{ alternatives: { id: string }[] }>(await request("GET", `/api/public/volunteers/portal/${tokens[0]!.accessToken}`));
    assert.equal(portal.alternatives.some((s) => s.id === target.id), false);
    await prisma.shift.update({ where: { id: target.id }, data: { swapAllowed: true } });
    const swap = json<{ id: string }>(await request("POST", path, undefined, body));
    const email = await prisma.volunteerEmail.findFirstOrThrow({ where: { applicationId: c.applications[1]!.id, kind: "SWAP_REQUEST" } });
    assert.equal(email.dedupeKey, `swap:${swap.id}`);
    await prisma.shift.update({ where: { id: source.id }, data: { swapAllowed: false } });
    assert.equal((await request("PATCH", `/api/public/volunteers/portal/${tokens[1]!.accessToken}/swaps/${swap.id}`, undefined, { accept: true })).statusCode, 409);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: source.id } })).assigneeId, c.person.id);
    const save = await request("PUT", `${c.base}/shifts/${target.id}`, c.authorization, { position: target.position, team: target.team, startsAt: target.startsAt.toISOString(), endsAt: target.endsAt.toISOString(), assigneeId: c.bob.id, swapAllowed: false });
    assert.equal(save.statusCode, 200, save.body);
    assert.equal((await prisma.volunteerSwap.findUniqueOrThrow({ where: { id: swap.id } })).status, "DECLINED");
    assert.equal((await request("POST", `${c.base}/shifts/batch`, c.authorization, { shift: { position: "Formation", startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), assigneeId: null, swapAllowed: false }, count: 2 })).statusCode, 201);
    assert.equal(await prisma.shift.count({ where: { position: "Formation", swapAllowed: false } }), 2);
  });
  it("exposes only busy intervals of this event's volunteers for calendar conflicts", async () => {
    const c = await context();
    const other = await prisma.event.create({ data: { workspaceId: c.workspace.id, name: "Private event", startsAt } });
    const stranger = await prisma.person.create({ data: { workspaceId: c.workspace.id, fullName: "Stranger" } });
    await prisma.shift.createMany({ data: [
      { ...c.shift, assigneeId: c.person.id },
      { ...c.shift, eventId: other.id, assigneeId: c.person.id, notes: "Private notes" },
      { ...c.shift, eventId: other.id, assigneeId: stranger.id },
    ] });
    const response = await request("GET", c.base, c.authorization);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(json<{ busySlots: unknown[] }>(response).busySlots, [
      { assigneeId: c.person.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    ]);
    assert.equal(response.body.includes("Private"), false);
    assert.equal(response.body.includes(stranger.id), false);
  });

  it("creates several open positions atomically and rejects assigned batches", async () => {
    const c = await context();
    const shift = { ...c.shift, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), assigneeId: null };
    assert.equal((await request("POST", `${c.base}/shifts/batch`, c.authorization, { shift, count: 3 })).statusCode, 201);
    assert.equal(await prisma.shift.count(), 3);
    assert.equal((await request("POST", `${c.base}/shifts/batch`, c.authorization, { shift: { ...shift, assigneeId: c.person.id }, count: 2 })).statusCode, 400);
    assert.equal((await request("POST", `${c.base}/shifts/batch`, c.authorization, { shift, count: 101 })).statusCode, 400);
    assert.equal(await prisma.shift.count(), 3);
  });

  it("rolls back conflicting assignments and refuses stale or duplicate proposals", async () => {
    const c = await context();
    const slots = await Promise.all([1, 2].map(() => prisma.shift.create({ data: c.shift })));
    const assignments = slots.map((s) => ({ shiftId: s.id, personId: c.person.id }));
    assert.equal((await request("POST", `${c.base}/assignments/apply`, c.authorization, assignments)).statusCode, 409);
    assert.equal(await prisma.shift.count({ where: { assigneeId: { not: null } } }), 0);
    assert.equal((await request("POST", `${c.base}/assignments/apply`, c.authorization, [assignments[0], assignments[0]])).statusCode, 400);
    assignments[1]!.personId = c.bob.id;
    assert.equal((await request("POST", `${c.base}/assignments/apply`, c.authorization, assignments)).statusCode, 200);
    assert.equal((await request("POST", `${c.base}/assignments/apply`, c.authorization, assignments)).statusCode, 409);
  });

  it("filters unsafe AI suggestions and sends only scheduling data", async (t) => {
    const c = await context();
    const slots = await Promise.all([1, 2, 3].map(() => prisma.shift.create({ data: c.shift })));
    const previous = process.env.DOCUMENT_AI_PROVIDER; const key = process.env.OPENAI_API_KEY;
    process.env.DOCUMENT_AI_PROVIDER = "openai"; process.env.OPENAI_API_KEY = "test";
    t.after(() => { if (previous === undefined) delete process.env.DOCUMENT_AI_PROVIDER; else process.env.DOCUMENT_AI_PROVIDER = previous; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
    let body = "";
    t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
      body = String(options.body);
      return new Response(JSON.stringify({ output_text: JSON.stringify({ assignments: [
        { shiftId: slots[0]!.id, personId: c.person.id }, { shiftId: slots[1]!.id, personId: c.person.id }, { shiftId: slots[2]!.id, personId: "foreign" },
      ] }) }), { status: 200 });
    });
    const r = await request("POST", `${c.base}/assignments/preview`, c.authorization);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(json<{ assignments: unknown[] }>(r).assignments.length, 1);
    assert.equal(await prisma.shift.count({ where: { assigneeId: { not: null } } }), 0);
    for (const secret of ["Alice", "bob@example.test", "SECRET", "PRIVATE"]) assert.equal(body.includes(secret), false);
  });

  it("requires organizer access and separates badges from personal links", async () => {
    const c = await context(); const tokens = await badges(c); const token = tokens[0]!;
    assert.notEqual(token.accessToken, token.badgeToken);
    assert.equal((await request("POST", `${c.base}/check-in`, undefined, { badgeToken: token.badgeToken })).statusCode, 401);
    assert.equal((await request("POST", `${c.base}/check-in`, c.authorization, { badgeToken: token.accessToken })).statusCode, 404);
    const r = await request("POST", `${c.base}/check-in`, c.authorization, { badgeToken: token.badgeToken });
    assert.equal(r.statusCode, 200, r.body);
    const again = await request("POST", `${c.base}/check-in`, c.authorization, { badgeToken: token.badgeToken });
    assert.equal(json<{ checkedInAt: string }>(again).checkedInAt, json<{ checkedInAt: string }>(r).checkedInAt);
    const portal = await request("GET", `/api/public/volunteers/portal/${token.accessToken}`);
    assert.equal(portal.statusCode, 200, portal.body);
    assert.equal(portal.body.includes("SECRET"), false); assert.equal(portal.body.includes("PRIVATE"), false);
    assert.equal((await request("GET", `/api/public/volunteers/portal/${token.badgeToken}`)).statusCode, 404);
    await request("POST", `${c.base}/applications/${c.applications[0]!.id}/badge`, c.authorization, { rotate: true });
    assert.equal((await request("GET", `/api/public/volunteers/portal/${token.accessToken}`)).statusCode, 404);
    assert.equal((await request("POST", `${c.base}/check-in`, c.authorization, { badgeToken: token.badgeToken })).statusCode, 404);
  });

  it("rejects badges from another event and invalidates credentials on withdrawal", async () => {
    const c = await context(); const [token] = await badges(c);
    const other = await prisma.event.create({ data: { workspaceId: c.workspace.id, name: "Other", startsAt } });
    assert.equal((await request("POST", `/api/events/${other.id}/volunteers/check-in`, c.authorization, { badgeToken: token!.badgeToken })).statusCode, 404);
    await request("PATCH", `${c.base}/applications/${c.applications[0]!.id}`, c.authorization, { status: "CANCELLED", team: "", internalNotes: "" });
    assert.equal((await request("GET", `/api/public/volunteers/portal/${token!.accessToken}`)).statusCode, 404);
    assert.equal((await request("POST", `${c.base}/check-in`, c.authorization, { badgeToken: token!.badgeToken })).statusCode, 404);
  });

  it("exchanges only after recipient acceptance, prevents duplicates and disallows replay", async () => {
    const c = await context(); const tokens = await badges(c);
    const source = await prisma.shift.create({ data: { ...c.shift, assigneeId: c.person.id } });
    const target = await prisma.shift.create({ data: { ...c.shift, startsAt: endsAt, endsAt: new Date(endsAt.getTime() + 3600000), assigneeId: c.bob.id } });
    const path = `/api/public/volunteers/portal/${tokens[0]!.accessToken}/swaps`;
    const body = { sourceShiftId: source.id, targetShiftId: target.id };
    const r = await request("POST", path, undefined, body);
    assert.equal(r.statusCode, 200, r.body); const id = json<{ id: string }>(r).id;
    assert.equal((await request("POST", path, undefined, body)).statusCode, 409);
    assert.equal((await request("PATCH", `${path}/${id}`, undefined, { accept: true })).statusCode, 404);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: source.id } })).assigneeId, c.person.id);
    const recipient = `/api/public/volunteers/portal/${tokens[1]!.accessToken}/swaps/${id}`;
    assert.equal((await request("PATCH", recipient, undefined, { accept: true })).statusCode, 200);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: source.id } })).assigneeId, c.bob.id);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: target.id } })).assigneeId, c.person.id);
    assert.equal((await request("PATCH", recipient, undefined, { accept: true })).statusCode, 404);
  });

  it("rechecks conflicts across events on acceptance without partially swapping", async () => {
    const c = await context(); const tokens = await badges(c);
    const source = await prisma.shift.create({ data: { ...c.shift, assigneeId: c.person.id } });
    const target = await prisma.shift.create({ data: { ...c.shift, startsAt: endsAt, endsAt: new Date(endsAt.getTime() + 3600000), assigneeId: c.bob.id } });
    const r = await request("POST", `/api/public/volunteers/portal/${tokens[0]!.accessToken}/swaps`, undefined, { sourceShiftId: source.id, targetShiftId: target.id });
    assert.equal(r.statusCode, 200, r.body);
    const other = await prisma.event.create({ data: { workspaceId: c.workspace.id, name: "Other", startsAt } });
    await prisma.shift.create({ data: { ...c.shift, eventId: other.id, assigneeId: c.bob.id } });
    const response = await request("PATCH", `/api/public/volunteers/portal/${tokens[1]!.accessToken}/swaps/${json<{ id: string }>(r).id}`, undefined, { accept: true });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: source.id } })).assigneeId, c.person.id);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: target.id } })).assigneeId, c.bob.id);
  });
});
