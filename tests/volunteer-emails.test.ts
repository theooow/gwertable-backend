import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
import { deliverVolunteerEmails } from "../src/workers/volunteer-email-worker.js";
import { renderVolunteerEmail, type VolunteerEmailContent } from "../src/lib/volunteer-email.js";

setupTestApp();
const startsAt = new Date(Date.now() + 7 * 86400000).toISOString();
const endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
const availability = [{ startsAt, endsAt }];
async function context() {
  const { authorization, workspace } = await seedAdminSession();
  const { event, person } = await seedEventContext(authorization);
  const base = `/api/events/${event.id}/volunteers`;
  const application = await prisma.volunteerApplication.create({ data: {
    eventId: event.id, personId: person.id, email: "volunteer@example.test", fullName: person.fullName, availability,
  } });
  return { authorization, workspace, event, person, base, application };
}
async function approve(c: Awaited<ReturnType<typeof context>>) {
  const response = await request("PATCH", `${c.base}/applications/${c.application.id}`, c.authorization, { status: "APPROVED", team: "Accueil", internalNotes: "" });
  assert.equal(response.statusCode, 200, response.body);
  return json<{ accessToken: string; badgeToken: string }>(response);
}

describe("volunteer email and confirmation flow", () => {
  it("queues registration once without exposing the personal link", async () => {
    const c = await context();
    const form = await prisma.volunteerForm.create({ data: { eventId: c.event.id, token: "f".repeat(43), published: true } });
    const body = { fullName: "Nouveau bénévole", email: "new@example.test", availability, consent: true };
    for (let i = 0; i < 2; i++) {
      const response = await request("POST", `/api/public/volunteers/${form.token}`, undefined, body);
      assert.equal(response.statusCode, 201, response.body);
      assert.deepEqual(Object.keys(json(response)), ["message"]);
    }
    assert.equal(await prisma.volunteerEmail.count({ where: { kind: "REGISTERED" } }), 1);
  });

  it("creates a usable unique portal link and only one approval email", async () => {
    const c = await context();
    const first = await approve(c);
    const second = await approve(c);
    assert.match(first.accessToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(second.accessToken, first.accessToken);
    assert.equal((await request("GET", `/api/public/volunteers/portal/${first.accessToken}`)).statusCode, 200);
    assert.equal(await prisma.volunteerEmail.count({ where: { kind: "APPROVED" } }), 1);
  });

  it("deduplicates planning emails, protects ownership and stale replies, and releases refused shifts", async () => {
    const c = await context();
    const { accessToken } = await approve(c);
    const shiftData = { position: "Accueil", startsAt, endsAt, assigneeId: c.person.id, team: "Accueil", notes: "" };
    const response = await request("POST", `${c.base}/shifts`, c.authorization, shiftData);
    assert.equal(response.statusCode, 201, response.body);
    const shift = json<{ id: string; confirmationVersion: number }>(response);
    for (const count of [1, 0]) {
      const r = await request("POST", `${c.base}/assignments/notify`, c.authorization, {});
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(json<{ count: number }>(r).count, count);
    }
    assert.equal((await request("POST", `${c.base}/assignments/notify`)).statusCode, 401);
    const path = `/api/public/volunteers/portal/${accessToken}/planning`;
    assert.equal((await request("PATCH", path, undefined, { accept: true, shifts: [{ id: shift.id, version: 0 }] })).statusCode, 200);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).confirmationStatus, "ACCEPTED");
    const edit = await request("PUT", `${c.base}/shifts/${shift.id}`, c.authorization, { ...shiftData, position: "Bar" });
    assert.equal(edit.statusCode, 200, edit.body);
    assert.equal((await request("PATCH", path, undefined, { accept: false, shifts: [{ id: shift.id, version: 0 }] })).statusCode, 409);
    const other = await prisma.person.create({ data: { workspaceId: c.workspace.id, fullName: "Other" } });
    await prisma.volunteerApplication.create({ data: { eventId: c.event.id, personId: other.id, fullName: "Other", status: "APPROVED", accessToken: "o".repeat(43) } });
    assert.equal((await request("PATCH", path.replace(accessToken, "o".repeat(43)), undefined, { accept: false, shifts: [{ id: shift.id, version: 1 }] })).statusCode, 409);
    assert.equal((await request("POST", `${c.base}/assignments/notify`, c.authorization, {})).statusCode, 200);
    assert.equal(await prisma.volunteerEmail.count({ where: { kind: "PLANNING" } }), 2);
    assert.equal((await request("PATCH", path, undefined, { accept: false, shifts: [{ id: shift.id, version: 1 }] })).statusCode, 200);
    const refused = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    assert.equal(refused.assigneeId, null);
    assert.equal(refused.confirmationStatus, "DECLINED");
    assert.equal((await request("PATCH", path, undefined, { accept: true, shifts: [{ id: shift.id, version: 1 }] })).statusCode, 409);
  });

  it("retries SMTP failures and builds branded emails using the current portal token", async () => {
    const c = await context();
    const { accessToken } = await approve(c);
    await prisma.workspace.update({ where: { id: c.workspace.id }, data: { logoUrl: "/api/uploads/association-logos/logo.png", emailPrimaryColor: "#7c3aed" } });
    const warnings: unknown[] = [];
    const logger = { warn: (...args: unknown[]) => { warnings.push(args); } };
    await prisma.volunteerEmail.updateMany({ data: { availableAt: new Date(0) } });
    await deliverVolunteerEmails(prisma, logger, async () => { throw new Error("SMTP unavailable"); });
    const job = await prisma.volunteerEmail.findFirstOrThrow();
    assert.equal(job.sentAt, null);
    assert.equal(job.attempts, 1);
    assert.equal(warnings.length, 1);
    await prisma.volunteerEmail.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
    const sent: VolunteerEmailContent[] = [];
    await deliverVolunteerEmails(prisma, logger, async (email, content) => {
      assert.equal(email, "volunteer@example.test"); sent.push(content);
    });
    assert.equal(sent.length, 1);
    assert.ok(sent[0]!.portalUrl?.endsWith(accessToken));
    assert.ok(sent[0]!.logoUrl?.startsWith("http"));
    assert.equal(sent[0]!.primaryColor, "#7c3aed");
    assert.ok(renderVolunteerEmail(sent[0]!).subject.startsWith(`${c.workspace.name} · `));
    assert.ok((await prisma.volunteerEmail.findUniqueOrThrow({ where: { id: job.id } })).sentAt);
    let duplicates = 0;
    await deliverVolunteerEmails(prisma, logger, async () => { duplicates++; });
    assert.equal(duplicates, 0);
  });

  it("does not send an approval link after the application is revoked", async () => {
    const c = await context();
    await approve(c);
    const r = await request("PATCH", `${c.base}/applications/${c.application.id}`, c.authorization, { status: "CANCELLED", team: "", internalNotes: "" });
    assert.equal(r.statusCode, 200, r.body);
    await prisma.volunteerEmail.updateMany({ data: { availableAt: new Date(0) } });
    let sent = 0;
    await deliverVolunteerEmails(prisma, { warn: () => {} }, async () => { sent++; });
    assert.equal(sent, 0);
    assert.ok((await prisma.volunteerEmail.findFirstOrThrow()).sentAt);
  });

  it("escapes user content and provides text, logo and an actionable planning link", () => {
    const result = renderVolunteerEmail({ kind: "PLANNING", fullName: "<script>alert(1)</script>", eventName: "A & B", associationName: "Association", logoUrl: "https://example.test/logo.png", portalUrl: "https://example.test/volunteers/portal/token" });
    assert.ok(!result.html.includes("<script>"));
    assert.ok(result.html.includes("A &amp; B"));
    assert.ok(result.html.includes('src="https://example.test/logo.png"'));
    assert.ok(result.text.includes("accepter ou refuser"));
    assert.ok(result.text.includes("https://example.test/volunteers/portal/token"));
  });

  it("requires admin access for logos, rejects invalid images and serves valid uploads publicly", async () => {
    const c = await context();
    const body = { fileName: "logo.png", contentType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
    assert.equal((await request("POST", "/api/workspace/logo", undefined, body)).statusCode, 401);
    assert.equal((await request("POST", "/api/workspace/logo", c.authorization, { ...body, data: Buffer.from("not an image").toString("base64") })).statusCode, 400);
    const r = await request("POST", "/api/workspace/logo", c.authorization, body);
    assert.equal(r.statusCode, 201, r.body);
    const { logoUrl } = json<{ logoUrl: string }>(r);
    assert.equal((await request("GET", logoUrl.replace("/api/uploads/", "/uploads/"))).statusCode, 200);
    assert.equal((await prisma.workspace.findUniqueOrThrow({ where: { id: c.workspace.id } })).logoUrl, logoUrl);
    await prisma.workspaceMember.updateMany({ where: { workspaceId: c.workspace.id }, data: { role: "ORGANIZER" } });
    assert.equal((await request("POST", "/api/workspace/logo", c.authorization, body)).statusCode, 403);
    assert.equal((await request("DELETE", "/api/workspace/logo", c.authorization)).statusCode, 403);
    await prisma.workspaceMember.updateMany({ where: { workspaceId: c.workspace.id }, data: { role: "ADMIN" } });
    assert.equal((await request("DELETE", "/api/workspace/logo", c.authorization)).statusCode, 200);
    assert.equal((await prisma.workspace.findUniqueOrThrow({ where: { id: c.workspace.id } })).logoUrl, null);
  });
});
