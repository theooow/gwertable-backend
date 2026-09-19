import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";

setupTestApp();
const formInput = { title: "Rejoignez l’équipe", description: "Présentation", confirmationMessage: "Merci !", published: true, closesAt: null, collectPhone: true, collectDietary: true, teams: ["Bar"], questions: [{ id: "experience", label: "Expérience", type: "select", required: true, options: ["Oui", "Non"] }] };
const submission = { fullName: "Alice publique", email: "alice@abregi.test", phone: "0611111111", preferredTeams: ["Bar"], availability: [{ startsAt: "2026-06-01T18:00:00Z", endsAt: "2026-06-02T03:00:00Z" }], dietary: "Végétarien", answers: { experience: "Oui" }, consent: true, mealIds: [] };
const review = { status: "APPROVED", team: "Bar", internalNotes: "À accueillir" };
const shift = { position: "Bar 1", startsAt: "2026-06-01T20:00:00Z", endsAt: "2026-06-01T22:00:00Z", assigneeId: null };
async function context() {
  const { authorization, workspace, user } = await seedAdminSession();
  const { event, person } = await seedEventContext(authorization);
  const base = `/api/events/${event.id}/volunteers`;
  const form = await request("PUT", `${base}/form`, authorization, formInput);
  assert.equal(form.statusCode, 200, form.body);
  const token = json<{ token: string }>(form).token;
  return { authorization, workspace, user, event, person, base, token, publicPath: `/api/public/volunteers/${token}` };
}

describe("volunteer management", () => {
  it("backfills existing volunteers without duplicating applications or changing assignments", async () => {
    const c = await context();
    await prisma.eventParticipant.create({ data: { eventId: c.event.id, personId: c.person.id, roles: ["ARTIST", "VOLUNTEER"], dietary: "Sans gluten" } });
    const assigned = await prisma.shift.create({ data: { ...shift, eventId: c.event.id, assigneeId: c.person.id } });
    const migration = await readFile(new URL("../prisma/migrations/20260919140000_link_volunteer_participants/migration.sql", import.meta.url), "utf8");
    const backfill = migration.slice(migration.indexOf('INSERT INTO'));
    await prisma.$executeRawUnsafe(backfill);
    await prisma.$executeRawUnsafe(backfill);
    assert.equal(await prisma.volunteerApplication.count(), 1);
    const application = await prisma.volunteerApplication.findFirstOrThrow();
    assert.equal(application.status, "APPROVED");
    assert.equal(application.dietary, "Sans gluten");
    assert.equal(application.consentAt, null);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: assigned.id } })).assigneeId, c.person.id);
    await prisma.person.update({ where: { id: c.person.id }, data: { fullName: "Alice actualisée" } });
    const overview = await request("GET", c.base, c.authorization);
    assert.equal(json<{ applications: { fullName: string }[] }>(overview).applications[0]!.fullName, "Alice actualisée");
  });

  it("links participants without email to volunteers and synchronizes roles, dietary and shifts", async () => {
    const c = await context();
    const person = await prisma.person.create({ data: { workspaceId: c.workspace.id, fullName: "Sans email" } });
    const payload = { personId: person.id, roles: ["GUEST", "VOLUNTEER"], dietary: "Sans gluten" };
    const created = await request("POST", `/api/events/${c.event.id}/participants`, c.authorization, payload);
    assert.equal(created.statusCode, 201, created.body);
    const participant = json<{ id: string }>(created);
    let application = await prisma.volunteerApplication.findFirstOrThrow({ where: { personId: person.id } });
    assert.equal(application.status, "APPROVED");
    assert.equal(application.dietary, "Sans gluten");
    assert.equal(application.email, null);
    assert.equal(application.consentAt, null);
    assert.deepEqual(application.availability, []);
    assert.equal((await request("POST", `${c.base}/shifts`, c.authorization, { ...shift, assigneeId: person.id })).statusCode, 409);
    await request("PATCH", `${c.base}/applications/${application.id}`, c.authorization, { ...review, availability: submission.availability });
    assert.equal((await request("POST", `${c.base}/shifts`, c.authorization, { ...shift, assigneeId: person.id })).statusCode, 201);
    const updated = await request("PUT", `/api/participants/${participant.id}`, c.authorization, { ...payload, dietary: "Végétarien" });
    assert.equal(updated.statusCode, 200, updated.body);
    application = await prisma.volunteerApplication.findUniqueOrThrow({ where: { id: application.id } });
    assert.equal(application.dietary, "Végétarien");
    assert.equal(await prisma.volunteerApplication.count({ where: { personId: person.id } }), 1);
    const removedRole = await request("PUT", `/api/participants/${participant.id}`, c.authorization, { ...payload, roles: ["GUEST"] });
    assert.equal(removedRole.statusCode, 200, removedRole.body);
    assert.deepEqual((await prisma.eventParticipant.findUniqueOrThrow({ where: { id: participant.id } })).roles, ["GUEST"]);
    assert.equal((await prisma.volunteerApplication.findUniqueOrThrow({ where: { id: application.id } })).status, "CANCELLED");
    assert.equal(await prisma.shift.count({ where: { assigneeId: person.id } }), 0);
    assert.equal((await request("PUT", `/api/participants/${participant.id}`, c.authorization, payload)).statusCode, 200);
    assert.equal((await prisma.volunteerApplication.findUniqueOrThrow({ where: { id: application.id } })).status, "APPROVED");
    assert.equal((await request("DELETE", `/api/participants/${participant.id}`, c.authorization)).statusCode, 200);
    assert.equal((await prisma.volunteerApplication.findUniqueOrThrow({ where: { id: application.id } })).status, "CANCELLED");
  });

  it("reuses a public application when granting the volunteer role and protects served meals", async () => {
    const c = await context();
    await request("POST", c.publicPath, undefined, submission);
    const payload = { personId: c.person.id, roles: ["GUEST", "VOLUNTEER"], dietary: "Végétarien" };
    const created = await request("POST", `/api/events/${c.event.id}/participants`, c.authorization, payload);
    assert.equal(created.statusCode, 201, created.body);
    const participant = json<{ id: string }>(created);
    const application = await prisma.volunteerApplication.findFirstOrThrow();
    assert.equal(application.status, "APPROVED");
    assert.equal(await prisma.volunteerApplication.count(), 1);
    assert.ok(application.consentAt);
    const service = await prisma.cateringService.create({ data: { eventId: c.event.id, label: "Dîner", startsAt: new Date(shift.startsAt) } });
    const booking = await prisma.cateringBooking.create({ data: { serviceId: service.id, applicationId: application.id, servedAt: new Date() } });
    assert.equal((await request("DELETE", `/api/participants/${participant.id}`, c.authorization)).statusCode, 409);
    assert.equal((await request("PUT", `/api/participants/${participant.id}`, c.authorization, { ...payload, roles: ["GUEST"] })).statusCode, 409);
    assert.deepEqual((await prisma.eventParticipant.findUniqueOrThrow({ where: { id: participant.id } })).roles, payload.roles);
    await prisma.cateringBooking.update({ where: { id: booking.id }, data: { servedAt: null } });
    assert.equal((await request("DELETE", `/api/participants/${participant.id}`, c.authorization)).statusCode, 200);
    assert.equal((await prisma.volunteerApplication.findFirstOrThrow()).status, "CANCELLED");
  });

  it("enforces meal capacity when approval comes from the participants screen", async () => {
    const c = await context();
    const service = await prisma.cateringService.create({ data: { eventId: c.event.id, label: "Dîner", startsAt: new Date(shift.startsAt), capacity: 1 } });
    await request("POST", c.publicPath, undefined, { ...submission, mealIds: [service.id] });
    await request("POST", c.publicPath, undefined, { ...submission, email: "bob@example.test", mealIds: [service.id] });
    const applications = await prisma.volunteerApplication.findMany();
    const responses = await Promise.all(applications.map((application) => request("POST", `/api/events/${c.event.id}/participants`, c.authorization, { personId: application.personId, roles: ["VOLUNTEER"] })));
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 409]);
    assert.equal(await prisma.eventParticipant.count(), 1);
    assert.equal(await prisma.volunteerApplication.count({ where: { status: "APPROVED" } }), 1);
  });

  it("accepts anonymous registrations, reuses contacts, preserves data and validates into participants", async () => {
    const c = await context();
    const publicForm = await request("GET", c.publicPath);
    assert.equal(publicForm.statusCode, 200);
    assert.equal(publicForm.body.includes("workspaceId"), false);
    assert.equal((await request("POST", c.publicPath, undefined, submission)).statusCode, 201);
    const app = await prisma.volunteerApplication.findFirstOrThrow();
    assert.equal(app.personId, c.person.id); assert.equal(app.status, "PENDING");
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: c.person.id } })).fullName, "Alice Martin");
    assert.equal(await prisma.eventParticipant.count(), 0);
    assert.equal((await request("POST", c.publicPath, undefined, { ...submission, fullName: "Overwrite" })).statusCode, 201);
    assert.equal(await prisma.volunteerApplication.count(), 1);
    assert.equal((await prisma.volunteerApplication.findUniqueOrThrow({ where: { id: app.id } })).fullName, submission.fullName);
    await prisma.eventParticipant.create({ data: { eventId: c.event.id, personId: c.person.id, roles: ["ARTIST"] } });
    const result = await request("PATCH", `${c.base}/applications/${app.id}`, c.authorization, review);
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual((await prisma.eventParticipant.findFirstOrThrow()).roles.sort(), ["ARTIST", "VOLUNTEER"]);
  });

  it("rejects invalid answers, closed forms, unknown meals and missing consent", async () => {
    const c = await context();
    for (const body of [{ ...submission, consent: false }, { ...submission, answers: {} }, { ...submission, preferredTeams: ["Unknown"] }, { ...submission, mealIds: ["unknown"] }, { ...submission, answers: { experience: "Other" } }, { ...submission, availability: [{ startsAt: "2026-06-02T03:00:00Z", endsAt: "2026-06-01T18:00:00Z" }] }]) {
      assert.equal((await request("POST", c.publicPath, undefined, body)).statusCode, 400);
    }
    assert.equal(await prisma.volunteerApplication.count(), 0);
    await request("PUT", `${c.base}/form`, c.authorization, { ...formInput, published: false });
    assert.equal((await request("GET", c.publicPath)).statusCode, 404);
    assert.equal((await request("POST", c.publicPath, undefined, submission)).statusCode, 404);
    await request("PUT", `${c.base}/form`, c.authorization, { ...formInput, closesAt: "2000-01-01T00:00:00Z" });
    assert.equal((await request("GET", c.publicPath)).statusCode, 404);
    await request("PUT", `${c.base}/form`, c.authorization, formInput);
    assert.equal((await request("POST", `${c.base}/form/rotate`, c.authorization)).statusCode, 200);
    assert.equal((await request("GET", c.publicPath)).statusCode, 404);
  });

  it("limits access to event organizers and scopes every nested resource", async () => {
    const c = await context();
    assert.equal((await request("GET", c.base)).statusCode, 401);
    const other = await prisma.event.create({ data: { workspaceId: c.workspace.id, name: "Other", startsAt: new Date() } });
    await request("POST", c.publicPath, undefined, submission);
    const app = await prisma.volunteerApplication.findFirstOrThrow();
    assert.equal((await request("PATCH", `/api/events/${other.id}/volunteers/applications/${app.id}`, c.authorization, review)).statusCode, 404);
    const outsider = await prisma.workspace.create({ data: { name: "Outside" } });
    const outsideEvent = await prisma.event.create({ data: { workspaceId: outsider.id, name: "Outside", startsAt: new Date() } });
    assert.equal((await request("GET", `/api/events/${outsideEvent.id}/volunteers`, c.authorization)).statusCode, 404);
    await prisma.workspaceMember.updateMany({ where: { userId: c.user.id }, data: { role: "VOLUNTEER" } });
    assert.equal((await request("GET", c.base, c.authorization)).statusCode, 403);
    await prisma.workspaceMember.deleteMany({ where: { userId: c.user.id } });
    await prisma.eventCollaborator.create({ data: { eventId: other.id, workspaceId: c.workspace.id, userId: c.user.id, email: c.user.email, role: "ORGANIZER", token: "collaborator-test", expires: new Date(Date.now() + 100000), acceptedAt: new Date() } });
    assert.equal((await request("GET", `/api/events/${other.id}/volunteers`, c.authorization)).statusCode, 200);
    assert.equal((await request("GET", c.base, c.authorization)).statusCode, 403);
  });

  it("requires approval and availability, prevents overlapping shifts and releases assignments on rejection", async () => {
    const c = await context();
    await request("POST", c.publicPath, undefined, submission);
    const app = await prisma.volunteerApplication.findFirstOrThrow();
    assert.equal((await request("POST", `${c.base}/shifts`, c.authorization, { ...shift, assigneeId: c.person.id })).statusCode, 400);
    await request("PATCH", `${c.base}/applications/${app.id}`, c.authorization, review);
    const created = await request("POST", `${c.base}/shifts`, c.authorization, { ...shift, assigneeId: c.person.id });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal((await request("PATCH", `${c.base}/applications/${app.id}`, c.authorization, { ...review, availability: [{ startsAt: "2026-06-01T23:00:00Z", endsAt: "2026-06-02T03:00:00Z" }] })).statusCode, 409);
    assert.equal((await request("PATCH", `${c.base}/applications/${app.id}`, c.authorization, { ...review, dietary: "Sans gluten" })).statusCode, 200);
    assert.equal((await prisma.eventParticipant.findFirstOrThrow()).dietary, "Sans gluten");
    assert.equal((await request("POST", `${c.base}/shifts`, c.authorization, { ...shift, assigneeId: c.person.id })).statusCode, 409);
    assert.equal((await request("POST", `${c.base}/shifts`, c.authorization, { ...shift, startsAt: "2026-06-01T16:00:00Z", assigneeId: c.person.id })).statusCode, 409);
    assert.equal((await request("POST", `${c.base}/shifts`, c.authorization, { ...shift, startsAt: "2026-06-01T22:00:00Z", endsAt: "2026-06-01T23:00:00Z", assigneeId: c.person.id })).statusCode, 201);
    await request("PATCH", `${c.base}/applications/${app.id}`, c.authorization, { ...review, status: "REJECTED" });
    assert.equal(await prisma.shift.count({ where: { assigneeId: c.person.id } }), 0);
    assert.equal(await prisma.eventParticipant.count(), 0);
  });

  it("enforces catering capacity under concurrent approvals and tracks served meals", async () => {
    const c = await context();
    const created = await request("POST", `${c.base}/services`, c.authorization, { label: "Dîner", startsAt: "2026-06-01T19:00:00Z", capacity: 1 });
    assert.equal(created.statusCode, 201, created.body);
    const service = json<{ id: string }>(created);
    await request("POST", c.publicPath, undefined, { ...submission, mealIds: [service.id] });
    await request("POST", c.publicPath, undefined, { ...submission, email: "bob@example.test", mealIds: [service.id] });
    const apps = await prisma.volunteerApplication.findMany();
    const approvals = await Promise.all(apps.map((a) => request("PATCH", `${c.base}/applications/${a.id}`, c.authorization, review)));
    assert.deepEqual(approvals.map((r) => r.statusCode).sort(), [200, 409]);
    const winner = await prisma.volunteerApplication.findFirstOrThrow({ where: { status: "APPROVED" }, include: { meals: true } });
    const meal = winner.meals[0]!;
    assert.equal((await request("PATCH", `${c.base}/bookings/${meal.id}`, c.authorization, { served: true })).statusCode, 200);
    assert.equal((await request("PATCH", `${c.base}/applications/${winner.id}`, c.authorization, { ...review, status: "CANCELLED" })).statusCode, 409);
    assert.equal((await request("PUT", `${c.base}/services/${service.id}/bookings`, c.authorization, { applicationId: winner.id, booked: false })).statusCode, 409);
    assert.equal((await request("DELETE", `${c.base}/services/${service.id}`, c.authorization)).statusCode, 409);
    await request("PATCH", `${c.base}/bookings/${meal.id}`, c.authorization, { served: false });
    await request("PUT", `${c.base}/services/${service.id}/bookings`, c.authorization, { applicationId: winner.id, booked: false });
    const waiting = apps.find((a) => a.id !== winner.id)!;
    assert.equal((await request("PATCH", `${c.base}/applications/${waiting.id}`, c.authorization, review)).statusCode, 200);
  });

  it("handles concurrent duplicate submissions and omits private answers from API logs", async () => {
    const c = await context();
    const responses = await Promise.all([1, 2, 3].map(() => request("POST", c.publicPath, undefined, { ...submission, email: "new@example.test", dietary: "private-dietary-value" })));
    assert.ok(responses.every((r) => r.statusCode === 201), responses.map((r) => r.body).join("\n"));
    assert.equal(await prisma.volunteerApplication.count(), 1);
    assert.equal(await prisma.person.count({ where: { email: "new@example.test" } }), 1);
    await request("GET", c.base, c.authorization);
    const logs = await prisma.apiLog.findMany({ where: { route: { contains: "volunteers" } } });
    assert.ok(logs.length);
    assert.equal(JSON.stringify(logs).includes("private-dietary-value"), false);
    assert.equal(JSON.stringify(logs).includes(c.token), false);
  });
});
