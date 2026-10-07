import assert from "node:assert/strict";
import { test } from "node:test";
import { request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();

test("client errors raised by Fastify keep their status and message", async () => {
  const { authorization } = await seedAdminSession();

  const unsupported = await request("POST", "/api/events", authorization, "{\"name\":\"Fête\"}", { "content-type": "application/xml" });
  assert.equal(unsupported.statusCode, 415);
  assert.equal(unsupported.json().code, "FST_ERR_CTP_INVALID_MEDIA_TYPE");
  assert.ok(unsupported.json().message);

  const malformed = await request("POST", "/api/events", authorization, "{\"name\":", { "content-type": "application/json" });
  assert.equal(malformed.statusCode, 400);
});
