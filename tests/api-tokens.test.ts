import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../src/prisma.js";
import { eventPayload, json, request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();

type CreatedToken = { id: string; token: string; tokenPrefix: string; scope: "READ" | "WRITE" };

async function createToken(authorization: string, scope: "READ" | "WRITE", expiresInDays?: number) {
  const response = await request("POST", "/api/account/api-tokens", authorization, { name: "Claude", scope, expiresInDays });
  assert.equal(response.statusCode, 201);
  return json<CreatedToken>(response);
}

test("a personal API token authenticates and only its hash is stored", async () => {
  const { authorization, user } = await seedAdminSession("PLATINIUM");
  const created = await createToken(authorization, "WRITE");

  assert.match(created.token, /^abr_/);
  assert.equal(created.tokenPrefix, created.token.slice(0, 12));
  const stored = await prisma.apiToken.findUniqueOrThrow({ where: { id: created.id } });
  assert.notEqual(stored.tokenHash, created.token);

  const me = await request("GET", "/api/auth/me", `Bearer ${created.token}`);
  assert.equal(me.statusCode, 200);
  assert.equal(json<{ user: { id: string } }>(me).user.id, user.id);
  assert.ok((await prisma.apiToken.findUniqueOrThrow({ where: { id: created.id } })).lastUsedAt);

  const listed = json<Array<Record<string, unknown>>>(await request("GET", "/api/account/api-tokens", authorization));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].token, undefined);
  assert.equal(listed[0].tokenHash, undefined);
});

test("a read-only token cannot write and no token can manage tokens", async () => {
  const { authorization } = await seedAdminSession("PLATINIUM");
  const readOnly = `Bearer ${(await createToken(authorization, "READ")).token}`;
  const write = `Bearer ${(await createToken(authorization, "WRITE")).token}`;

  assert.equal((await request("GET", "/api/events", readOnly)).statusCode, 200);
  assert.equal((await request("POST", "/api/events", readOnly, eventPayload)).statusCode, 403);
  assert.equal((await request("POST", "/api/events", write, eventPayload)).statusCode, 201);
  assert.equal((await request("GET", "/api/account/api-tokens", write)).statusCode, 403);
  assert.equal((await request("POST", "/api/account/api-tokens", write, { name: "Escalade", scope: "WRITE" })).statusCode, 403);
  assert.equal((await request("DELETE", "/api/account", write)).statusCode, 403);
});

test("revoked and expired tokens are rejected", async () => {
  const { authorization } = await seedAdminSession("PLATINIUM");
  const revoked = await createToken(authorization, "READ");
  assert.equal((await request("DELETE", `/api/account/api-tokens/${revoked.id}`, authorization)).statusCode, 200);
  assert.equal((await request("GET", "/api/events", `Bearer ${revoked.token}`)).statusCode, 401);
  assert.equal((await request("DELETE", `/api/account/api-tokens/${revoked.id}`, authorization)).statusCode, 404);

  const expired = await createToken(authorization, "READ", 1);
  await prisma.apiToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await request("GET", "/api/events", `Bearer ${expired.token}`)).statusCode, 401);
});

test("API tokens and the MCP server are reserved to the Platinium plan", async () => {
  const { authorization, user } = await seedAdminSession();
  const refused = await request("POST", "/api/account/api-tokens", authorization, { name: "Claude", scope: "READ" });
  assert.equal(refused.statusCode, 403);
  assert.match(refused.body, /Platinium/);
  assert.equal((await request("POST", "/mcp", authorization, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { accept: "application/json, text/event-stream" })).statusCode, 403);

  await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PLATINIUM" } });
  const token = `Bearer ${(await createToken(authorization, "READ")).token}`;
  assert.equal((await request("GET", "/api/events", token)).statusCode, 200);

  await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "BETA_TEST" } });
  assert.equal((await request("GET", "/api/events", token)).statusCode, 403);
  assert.equal((await request("GET", "/api/account/api-tokens", authorization)).statusCode, 200);
});
