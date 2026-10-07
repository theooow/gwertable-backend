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
  const { authorization, user } = await seedAdminSession();
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
  const { authorization } = await seedAdminSession();
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
  const { authorization } = await seedAdminSession();
  const revoked = await createToken(authorization, "READ");
  assert.equal((await request("DELETE", `/api/account/api-tokens/${revoked.id}`, authorization)).statusCode, 204);
  assert.equal((await request("GET", "/api/events", `Bearer ${revoked.token}`)).statusCode, 401);
  assert.equal((await request("DELETE", `/api/account/api-tokens/${revoked.id}`, authorization)).statusCode, 404);

  const expired = await createToken(authorization, "READ", 1);
  await prisma.apiToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await request("GET", "/api/events", `Bearer ${expired.token}`)).statusCode, 401);
});
