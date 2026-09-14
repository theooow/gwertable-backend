import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "../src/prisma.js";
import { verifyCompany } from "../src/services/super-pdp.service.js";
import { json, request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();
const payload = { direction: "OUTGOING", counterpartName: "Client", counterpartSiren: "123456789", lines: [{ label: "Prestation", quantity: 2, unitPriceHt: 10.25, vatRateBasisPoints: 2000 }] };
type Invoice = { id: string; status: string; number: string; totalTtcCents: number; lines: { label: string }[] };

describe("organizer invoicing", () => {
  it("rejects sandbox, unknown identities and another company's authorization", () => {
    const company = { id: 1, number: "123456789", number_scheme: "fr_siren", env: "production", formal_name: "Organizer" };
    assert.equal(verifyCompany(company, "123456789").id, 1);
    assert.throws(() => verifyCompany({ ...company, env: "sandbox" }, "123456789"), /sandbox/);
    assert.throws(() => verifyCompany(company, "987654321"), /SIREN/);
    assert.throws(() => verifyCompany({ ...company, number_scheme: "sandbox" }, "123456789"), /SIREN/);
    assert.throws(() => verifyCompany({ id: 1 }, "123456789"), /vérifier/);
  });

  it("allows organizers to configure their company, but not viewers", async () => {
    const { authorization, workspace, user } = await seedAdminSession();
    await prisma.workspaceMember.updateMany({ where: { userId: user.id, workspaceId: workspace.id }, data: { role: "ORGANIZER" } });
    const response = await request("PUT", "/api/workspace/electronic-invoicing/legal-entity", authorization, { legalName: "Organizer", siren: "123456789" });
    assert.equal(response.statusCode, 200, response.body);
    await prisma.workspaceMember.updateMany({ where: { userId: user.id, workspaceId: workspace.id }, data: { role: "VIEWER" } });
    assert.equal((await request("GET", "/api/workspace/electronic-invoicing", authorization)).statusCode, 403);
  });

  it("edits only own drafts, computes totals and locks issued invoices", async () => {
    const { authorization, workspace } = await seedAdminSession();
    await prisma.legalEntity.create({ data: { workspaceId: workspace.id, legalName: "Organizer", siren: "123456789" } });
    const created = await request("POST", "/api/finance/invoices", authorization, payload);
    assert.equal(created.statusCode, 201, created.body);
    const invoice = json<Invoice>(created);
    assert.equal(invoice.totalTtcCents, 2460);
    const edited = await request("PUT", `/api/finance/invoices/${invoice.id}`, authorization, { ...payload, lines: [{ label: "Updated", quantity: 3, unitPriceHt: 10, vatRateBasisPoints: 0 }] });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(json<Invoice>(edited).totalTtcCents, 3000);
    assert.equal(json<Invoice>(edited).lines.length, 1);
    const issued = await request("POST", `/api/finance/invoices/${invoice.id}/issue`, authorization);
    assert.equal(issued.statusCode, 200, issued.body);
    assert.match(json<Invoice>(issued).number, /^FAC-\d{4}-0001$/);
    assert.equal((await request("PUT", `/api/finance/invoices/${invoice.id}`, authorization, payload)).statusCode, 400);
    await prisma.legalEntity.update({ where: { workspaceId: workspace.id }, data: { legalName: "New name" } });
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    assert.equal((saved.issuerSnapshot as { legalName: string }).legalName, "Organizer");
    assert.equal(json<Invoice>(await request("POST", `/api/finance/invoices/${invoice.id}/issue`, authorization)).number, json<Invoice>(issued).number);
    const other = await prisma.workspace.create({ data: { name: "Other organizer" } });
    const foreign = await prisma.invoice.create({ data: { workspaceId: other.id, direction: "OUTGOING", counterpartName: "Private client" } });
    assert.equal((await request("GET", `/api/finance/invoices/${foreign.id}`, authorization)).statusCode, 404);
    assert.equal((await request("PUT", `/api/finance/invoices/${foreign.id}`, authorization, payload)).statusCode, 404);
    assert.equal((await request("POST", `/api/finance/invoices/${foreign.id}/issue`, authorization)).statusCode, 404);
  });

  it("assigns distinct numbers under concurrent issuance", async () => {
    const { authorization, workspace } = await seedAdminSession();
    await prisma.legalEntity.create({ data: { workspaceId: workspace.id, legalName: "Organizer", siren: "123456789" } });
    const first = json<Invoice>(await request("POST", "/api/finance/invoices", authorization, payload));
    const second = json<Invoice>(await request("POST", "/api/finance/invoices", authorization, payload));
    const responses = await Promise.all([first, second].map(invoice => request("POST", `/api/finance/invoices/${invoice.id}/issue`, authorization)));
    for (const response of responses) assert.equal(response.statusCode, 200, response.body);
    assert.notEqual(json<Invoice>(responses[0]!).number, json<Invoice>(responses[1]!).number);
  });

  it("disconnects only this workspace and invalidates pending consent", async () => {
    const { authorization, workspace, user } = await seedAdminSession();
    const other = await prisma.workspace.create({ data: { name: "Other" } });
    for (const workspaceId of [workspace.id, other.id]) await prisma.electronicInvoicingConnection.create({ data: { workspaceId, provider: "SUPER_PDP", accessToken: "encrypted", status: "CONNECTED" } });
    await prisma.electronicInvoicingOAuthState.create({ data: { workspaceId: workspace.id, userId: user.id, provider: "SUPER_PDP", state: "pending-consent", expiresAt: new Date(Date.now() + 60000) } });
    assert.equal((await request("DELETE", "/api/workspace/electronic-invoicing/super-pdp", authorization)).statusCode, 200);
    assert.equal(await prisma.electronicInvoicingConnection.count({ where: { workspaceId: workspace.id } }), 0);
    assert.equal(await prisma.electronicInvoicingConnection.count({ where: { workspaceId: other.id } }), 1);
    assert.ok((await prisma.electronicInvoicingOAuthState.findUnique({ where: { state: "pending-consent" } }))?.consumedAt);
  });
});
