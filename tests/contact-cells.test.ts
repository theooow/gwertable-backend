import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { request, seedAdminSession, seedEventContext, setupTestApp } from "./helpers.js";
import { prisma } from "../src/prisma.js";
setupTestApp();
describe("contact spreadsheet edits", () => {
  it("updates only submitted cells, retaining CRM fields and tags", async () => {
    const { authorization } = await seedAdminSession();
    const { person } = await seedEventContext(authorization);
    await prisma.person.update({ where: { id: person.id }, data: { contactType: "ARTIST", negotiatedPrices: "Keep this", tags: ["existing"] } });
    const response = await request("PATCH", `/api/people/${person.id}`, authorization, { phone: "0622222222" });
    assert.equal(response.statusCode, 200, response.body);
    const updated = await prisma.person.findUniqueOrThrow({ where: { id: person.id } });
    assert.equal(updated.phone, "0622222222"); assert.equal(updated.negotiatedPrices, "Keep this"); assert.equal(updated.contactType, "ARTIST"); assert.deepEqual(updated.tags, ["existing"]);
    assert.equal((await request("PATCH", `/api/people/${person.id}`, authorization, { workspaceId: "outside" })).statusCode, 400);
    assert.equal((await request("PATCH", `/api/people/${person.id}`, authorization, { fullName: "" })).statusCode, 400);
    assert.equal((await request("PATCH", `/api/people/${person.id}`, authorization, {})).statusCode, 400);
    assert.equal((await request("PATCH", `/api/people/${person.id}`, authorization, { email: "UPPER@EXAMPLE.TEST" })).statusCode, 200);
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).email, "upper@example.test");
  });
  it("denies non-organizers and contacts from another workspace", async () => {
    const { authorization, user } = await seedAdminSession();
    const { person } = await seedEventContext(authorization);
    const workspace = await prisma.workspace.create({ data: { name: "Other" } });
    const other = await prisma.person.create({ data: { workspaceId: workspace.id, fullName: "Other", tags: [] } });
    assert.equal((await request("PATCH", `/api/people/${other.id}`, authorization, { phone: "123" })).statusCode, 404);
    await prisma.workspaceMember.updateMany({ where: { userId: user.id }, data: { role: "VIEWER" } });
    assert.equal((await request("PATCH", `/api/people/${person.id}`, authorization, { phone: "123" })).statusCode, 403);
  });
});
