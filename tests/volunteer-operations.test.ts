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
