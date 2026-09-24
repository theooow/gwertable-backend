import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import { json, request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
import { contractMailer } from "../src/lib/mailer.js";
import { sha256 } from "../src/repositories/volunteer-contract.repository.js";
import { EmailDeliveryError } from "../src/lib/errors.js";

setupTestApp();
let emails: { email: string; text: string }[];
beforeEach(() => {
  mock.restoreAll(); emails = [];
  mock.method(contractMailer, "send", async (email: string, _subject: string, text: string) => { emails.push({ email, text }); });
});
async function context() {
  const { authorization, workspace, user } = await seedAdminSession();
  const { event, person } = await seedEventContext(authorization);
  const application = await prisma.volunteerApplication.create({ data: { eventId: event.id, personId: person.id, fullName: person.fullName, status: "APPROVED" } });
  const base = `/api/events/${event.id}/volunteers/contracts`;
  const input = { applicationId: application.id, title: "Convention de bénévolat", organization: "Association Test, 1 rue Test, Paris", representative: "Camille Dupont, présidente", terms: "Mission : accueil des participants. Engagement libre, non rémunéré. Respect des consignes de sécurité.", authorized: true };
  const created = await request("POST", base, authorization, input);
  assert.equal(created.statusCode, 201, created.body);
  const contract = json<{ id: string; documentHash: string }>(created);
  return { authorization, workspace, user, event, person, application, base, input, contract };
}
async function invite(c: Awaited<ReturnType<typeof context>>) {
  const response = await request("POST", `${c.base}/${c.contract.id}/invite`, c.authorization);
  assert.equal(response.statusCode, 200, response.body);
  const token = emails.at(-1)!.text.match(/contracts\/([\w-]{43})/)![1]!;
  return { token, path: `/api/public/volunteers/contracts/${token}` };
}
async function code(path: string) {
  const response = await request("POST", `${path}/code`);
  assert.equal(response.statusCode, 200, response.body);
  return emails.at(-1)!.text.match(/Votre code : (\d{6})/)![1]!;
}

describe("volunteer contracts", () => {
  it("signs the immutable document once and exposes identical PDFs in both authorized contexts", async () => {
    const c = await context(); const { path } = await invite(c); const otp = await code(path);
    assert.equal(emails[0]!.email, "alice@abregi.test");
    const body = { code: otp, name: c.person.fullName, documentHash: c.contract.documentHash, consent: true };
    assert.equal((await request("POST", `${path}/sign`, undefined, { ...body, consent: false })).statusCode, 400);
    assert.equal((await request("POST", `${path}/sign`, undefined, { ...body, documentHash: "a".repeat(64) })).statusCode, 400);
    const results = await Promise.all([request("POST", `${path}/sign`, undefined, body), request("POST", `${path}/sign`, undefined, body)]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
    const saved = await prisma.volunteerContract.findUniqueOrThrow({ where: { id: c.contract.id } });
    assert.equal(saved.status, "SIGNED"); assert.equal(saved.codeHash, null);
    assert.equal(sha256(Buffer.from(saved.sourcePdf)), c.contract.documentHash);
    assert.equal(sha256(Buffer.from(saved.signedPdf!)), saved.signedPdfHash);
    const personBase = `/api/people/${c.person.id}/volunteers/contracts`;
    for (const base of [c.base, personBase]) {
      const list = await request("GET", base, c.authorization);
      assert.equal(json<{ id: string }[]>(list)[0]!.id, c.contract.id);
      assert.equal(list.body.includes("tokenHash"), false);
      const pdf = await request("GET", `${base}/${c.contract.id}/pdf`, c.authorization);
      assert.equal(pdf.statusCode, 200); assert.equal(sha256(pdf.rawPayload), saved.signedPdfHash);
      assert.equal(pdf.headers["cache-control"], "no-store");
    }
    assert.equal((await request("GET", `${path}/pdf`)).statusCode, 200);
    const proof = await request("GET", `${path}/proof`);
    assert.equal(proof.body.includes(otp), false);
    assert.equal(json<{ evidence: { method: string } }>(proof).evidence.method, "EMAIL_OTP_SIMPLE");
    await prisma.person.update({ where: { id: c.person.id }, data: { fullName: "Changed", email: "changed@example.test" } });
    assert.equal((await request("GET", path)).json().signerName, c.person.fullName);
    await assert.rejects(prisma.volunteerContract.update({ where: { id: c.contract.id }, data: { content: "tampered" } }));
    await assert.rejects(prisma.event.delete({ where: { id: c.event.id } }));
    assert.equal((await request("POST", `${c.base}/${c.contract.id}/cancel`, c.authorization)).statusCode, 409);
    const logs = await prisma.apiLog.findMany({ where: { route: { contains: "/volunteers/contracts" } } });
    const audit = JSON.stringify(logs);
    assert.equal(audit.includes(otp), false);
    assert.equal(audit.includes(saved.tokenHash), false);
  });

  it("limits delivery and verification attempts, expires codes and invalidates old invitation links", async () => {
    const c = await context(); const { path } = await invite(c); const otp = await code(path);
    assert.equal((await request("POST", `${path}/code`)).statusCode, 409);
    const body = { code: otp === "000000" ? "111111" : "000000", name: c.person.fullName, documentHash: c.contract.documentHash, consent: true };
    for (let i = 0; i < 5; i++) assert.equal((await request("POST", `${path}/sign`, undefined, body)).statusCode, 400);
    assert.equal((await request("POST", `${path}/sign`, undefined, { ...body, code: otp })).statusCode, 400);
    assert.equal((await prisma.volunteerContract.findUniqueOrThrow({ where: { id: c.contract.id } })).codeAttempts, 5);
    await prisma.volunteerContract.update({ where: { id: c.contract.id }, data: { codeSentAt: new Date(0) } });
    const newCode = await code(path);
    await prisma.volunteerContract.update({ where: { id: c.contract.id }, data: { codeExpiresAt: new Date(0), invitationSentAt: new Date(0) } });
    assert.equal((await request("POST", `${path}/sign`, undefined, { ...body, code: newCode })).statusCode, 400);
    const next = await invite(c);
    assert.equal((await request("GET", path)).statusCode, 404);
    await request("POST", `${c.base}/${c.contract.id}/cancel`, c.authorization);
    assert.equal((await request("GET", next.path)).statusCode, 404);
  });

  it("enforces workspace, event and contact isolation and volunteer permissions", async () => {
    const c = await context();
    assert.equal((await request("GET", c.base)).statusCode, 401);
    const otherEvent = await prisma.event.create({ data: { workspaceId: c.workspace.id, name: "Other", startsAt: new Date() } });
    assert.equal((await request("GET", `/api/events/${otherEvent.id}/volunteers/contracts/${c.contract.id}/source`, c.authorization)).statusCode, 404);
    const otherPerson = await prisma.person.create({ data: { workspaceId: c.workspace.id, fullName: "Other" } });
    assert.equal((await request("GET", `/api/people/${otherPerson.id}/volunteers/contracts/${c.contract.id}/source`, c.authorization)).statusCode, 404);
    await prisma.workspaceMember.updateMany({ where: { userId: c.user.id }, data: { role: "VIEWER" } });
    assert.equal((await request("GET", c.base, c.authorization)).statusCode, 403);
    assert.equal((await request("GET", `/api/people/${c.person.id}/volunteers/contracts`, c.authorization)).statusCode, 403);
    const otherWorkspace = await prisma.workspace.create({ data: { name: "Other" } });
    await prisma.workspaceMember.create({ data: { userId: c.user.id, workspaceId: otherWorkspace.id, role: "ADMIN" } });
    await prisma.user.update({ where: { id: c.user.id }, data: { defaultWorkspaceId: otherWorkspace.id } });
    assert.equal((await request("GET", c.base, c.authorization)).statusCode, 404);
    assert.equal((await request("GET", `/api/people/${c.person.id}/volunteers/contracts`, c.authorization)).statusCode, 404);
  });

  it("requires approved volunteers, rejects modifying the source and reports mail failures", async () => {
    const c = await context();
    await assert.rejects(prisma.volunteerContract.update({ where: { id: c.contract.id }, data: { signerEmail: "attacker@example.test" } }));
    assert.equal((await request("POST", c.base, c.authorization, { ...c.input, authorized: false })).statusCode, 400);
    await prisma.volunteerApplication.update({ where: { id: c.application.id }, data: { status: "REJECTED" } });
    assert.equal((await request("POST", c.base, c.authorization, c.input)).statusCode, 400);
    mock.method(contractMailer, "send", async () => { throw new EmailDeliveryError("SMTP failure"); });
    assert.equal((await request("POST", `${c.base}/${c.contract.id}/invite`, c.authorization)).statusCode, 502);
    const saved = await prisma.volunteerContract.findUniqueOrThrow({ where: { id: c.contract.id } });
    assert.equal(saved.invitationSentAt, null);
  });

  it("limits event collaborators to their invited event and denies the contact route", async () => {
    const c = await context();
    await prisma.workspaceMember.deleteMany({ where: { userId: c.user.id } });
    await prisma.eventCollaborator.create({ data: {
      eventId: c.event.id, workspaceId: c.workspace.id, userId: c.user.id, email: c.user.email,
      role: "VOLUNTEER", token: "contract-event-invitation", expires: new Date(Date.now() + 600000), acceptedAt: new Date(),
    } });
    assert.equal((await request("GET", `${c.base}/${c.contract.id}/source`, c.authorization)).statusCode, 200);
    assert.equal((await request("GET", `/api/people/${c.person.id}/volunteers/contracts/${c.contract.id}/source`, c.authorization)).statusCode, 403);
    const other = await prisma.event.create({ data: { workspaceId: c.workspace.id, name: "Not invited", startsAt: new Date() } });
    assert.equal((await request("GET", `/api/events/${other.id}/volunteers/contracts`, c.authorization)).statusCode, 403);
  });
});
