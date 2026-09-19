import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "../src/prisma.js";
import { request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();

describe("equipment spreadsheet edits", () => {
  it("saves independent cells and clears colors without replacing other fields", async () => {
    const { authorization, workspace } = await seedAdminSession();
    const item = await prisma.equipmentItem.create({ data: {
      workspaceId: workspace.id, name: "Projecteur", category: "lumière", ownership: "RENTED",
      quantity: 8, unitPriceCents: 1234, rentalCoef: 2, amountInputMode: "HT",
      vatRateBasisPoints: 550, photoUrl: "/photo.png", notes: "À conserver",
    } });
    assert.equal((await request("PATCH", `/api/equipment/${item.id}`, authorization, { color: "#EF4444" })).statusCode, 200);
    assert.equal((await request("PATCH", `/api/equipment/${item.id}`, authorization, { quantity: 12 })).statusCode, 200);
    const updated = await prisma.equipmentItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(updated.color, "#EF4444");
    assert.equal(updated.quantity, 12);
    for (const key of ["name", "category", "ownership", "unitPriceCents", "rentalCoef", "amountInputMode", "vatRateBasisPoints", "photoUrl", "notes"] as const) {
      assert.equal(String(updated[key]), String(item[key]), key);
    }
    assert.equal((await request("PATCH", `/api/equipment/${item.id}`, authorization, { color: null })).statusCode, 200);
    assert.equal((await prisma.equipmentItem.findUniqueOrThrow({ where: { id: item.id } })).color, null);
  });

  it("enforces workspace boundaries, supplier ownership and write permissions", async () => {
    const { authorization, workspace, user } = await seedAdminSession();
    const other = await prisma.workspace.create({ data: { name: "Other" } });
    const item = await prisma.equipmentItem.create({ data: { workspaceId: workspace.id, name: "Matos", category: "son", ownership: "OWNED" } });
    const foreignItem = await prisma.equipmentItem.create({ data: { workspaceId: other.id, name: "Other", category: "son", ownership: "OWNED" } });
    const supplier = await prisma.person.create({ data: { workspaceId: other.id, fullName: "Other", contactType: "VENDOR" } });
    assert.equal((await request("PATCH", `/api/equipment/${foreignItem.id}`, authorization, { name: "Forbidden" })).statusCode, 404);
    assert.equal((await request("PATCH", `/api/equipment/${item.id}`, authorization, { supplierId: supplier.id })).statusCode, 404);
    for (const input of [{}, { workspaceId: other.id }, { color: "red" }, { quantity: 0 }]) {
      assert.equal((await request("PATCH", `/api/equipment/${item.id}`, authorization, input)).statusCode, 400);
    }
    await prisma.workspaceMember.updateMany({ where: { userId: user.id }, data: { role: "VIEWER" } });
    assert.equal((await request("PATCH", `/api/equipment/${item.id}`, authorization, { color: "#123456" })).statusCode, 403);
  });
});
