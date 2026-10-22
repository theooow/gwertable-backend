import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../src/prisma.js";
import { eventPayload, json, request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();

const createEvent = (authorization: string, status = "PLANNING") => request("POST", "/api/events", authorization, { ...eventPayload, status });

test("Lite and Plus cap events in progress, closed events free a slot", async () => {
  const { authorization, user } = await seedAdminSession("LITE");
  const first = json<{ id: string }>(await createEvent(authorization));
  const refused = await createEvent(authorization);
  assert.equal(refused.statusCode, 403);
  assert.match(refused.body, /plan Lite est limité à 1 événement en cours/);
  assert.equal(json<{ code: string }>(refused).code, "PLAN_REQUIRED");
  assert.equal(json<{ requiredPlan: string }>(refused).requiredPlan, "PLUS");
  assert.equal((await createEvent(authorization, "DONE")).statusCode, 201);

  await request("PUT", `/api/events/${first.id}`, authorization, { ...eventPayload, status: "ARCHIVED" });
  const second = await createEvent(authorization);
  assert.equal(second.statusCode, 201);
  assert.equal((await request("PUT", `/api/events/${first.id}`, authorization, { ...eventPayload, status: "PLANNING" })).statusCode, 403);
  assert.equal((await request("PUT", `/api/events/${json<{ id: string }>(second).id}`, authorization, { ...eventPayload, name: "Renamed" })).statusCode, 200);

  await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PLUS" } });
  assert.equal((await createEvent(authorization)).statusCode, 201);
  assert.equal((await createEvent(authorization)).statusCode, 201);
  assert.equal((await createEvent(authorization)).statusCode, 403);

  await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PRO" } });
  assert.equal((await createEvent(authorization)).statusCode, 201);
});

test("accounts without subscription keep closed events but cannot run one", async () => {
  const { authorization } = await seedAdminSession("NONE");
  assert.equal((await createEvent(authorization, "DONE")).statusCode, 201);
  const refused = await createEvent(authorization);
  assert.equal(refused.statusCode, 403);
  assert.match(refused.body, /Choisis un abonnement/);
  assert.equal(json<{ requiredPlan: string }>(refused).requiredPlan, "LITE");
});

test("events of another workspace the user administers count towards the cap", async () => {
  const { authorization, user } = await seedAdminSession("LITE");
  const other = await prisma.workspace.create({ data: { name: "Other", members: { create: { userId: user.id, role: "ADMIN" } } } });
  await prisma.event.create({ data: { workspaceId: other.id, name: "Elsewhere", startsAt: new Date(), status: "LIVE" } });
  assert.equal((await createEvent(authorization)).statusCode, 403);
});

test("inviting collaborators is reserved to the Pro plan", async () => {
  const { authorization, user } = await seedAdminSession("PLUS");
  const event = json<{ id: string }>(await createEvent(authorization));
  const invite = () => request("POST", "/api/workspace/invitations", authorization, { email: "collab@abregi.test", role: "VOLUNTEER" });
  const collaborate = () => request("POST", `/api/events/${event.id}/collaborators`, authorization, { email: "guest@abregi.test", role: "VOLUNTEER" });

  const refused = await invite();
  assert.equal(refused.statusCode, 403);
  assert.match(refused.body, /plan Pro/);
  assert.equal(json<{ requiredPlan: string }>(refused).requiredPlan, "PRO");
  assert.equal((await collaborate()).statusCode, 403);

  await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PRO" } });
  assert.equal((await invite()).statusCode, 201);
  assert.equal((await collaborate()).statusCode, 201);
});
