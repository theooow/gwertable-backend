import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Fastify from "fastify";
import { prisma } from "../src/prisma.js";
import { apiLogsPlugin } from "../src/plugins/api-logs.js";
import { sanitizeLog, logAction } from "../src/lib/log-sanitizer.js";

const originalCreate = prisma.apiLog.create;
const originalDeleteMany = prisma.apiLog.deleteMany;
afterEach(() => { prisma.apiLog.create = originalCreate; prisma.apiLog.deleteMany = originalDeleteMany; });

describe("API journal", () => {
  it("redacts nested credentials, signed URLs and limits payload size", () => {
    const result = JSON.stringify(sanitizeLog({ password: "secret-pass", nested: [{ sessionToken: "secret-token", code: "123456" }],
      url: "https://example.test?token=secret-url&ok=1", message: "Bearer secret-bearer", image: "secret-image" }));
    for (const secret of ["secret-pass", "secret-token", "123456", "secret-url", "secret-bearer", "secret-image"]) assert.ok(!result.includes(secret));
    assert.ok(result.includes("ok=1"));
    assert.ok(Buffer.byteLength(JSON.stringify(sanitizeLog({ large: "é".repeat(100000) }))) <= 32768);
    assert.equal(logAction("POST", "/api/events", 201), "Événement créé");
    assert.equal(logAction("POST", "/api/events", 400), null);
  });

  it("captures successful actions, failures, identity and responses without leaking credentials", async () => {
    const rows: any[] = [];
    prisma.apiLog.create = (async ({ data }: any) => { rows.push(data); return data; }) as typeof prisma.apiLog.create;
    prisma.apiLog.deleteMany = (async () => ({ count: 0 })) as typeof prisma.apiLog.deleteMany;
    const app = Fastify();
    await app.register(apiLogsPlugin);
    app.post("/api/auth/register", async (_request, reply) => reply.code(201).send({ sessionToken: "hidden-session", user: { id: "user-1", email: "person@test.fr" } }));
    app.get("/api/broken", async () => { throw new Error("failure"); });
    app.get("/api/admin/logs", async () => ({ logs: ["recursive-payload"] }));
    app.get("/api/private", { preHandler: async (_request, reply) => { reply.code(401).send({ error: "Unauthorized" }); } }, async () => ({}));
    try {
      const response = await app.inject({ method: "POST", url: "/api/auth/register?token=hidden-query", payload: { email: "person@test.fr", password: "hidden-password" } });
      await app.inject("/api/broken");
      await app.inject("/api/admin/logs");
      await app.inject("/api/private");
      assert.equal(rows.length, 4);
      assert.equal(rows[0].userId, "user-1");
      assert.equal(rows[0].requestId, response.headers["x-request-id"]);
      assert.equal(rows[0].action, "Compte créé");
      assert.equal(rows[1].statusCode, 500);
      assert.equal(rows[1].responseBody.message, "failure");
      assert.equal(rows[3].statusCode, 401);
      assert.equal(rows[3].responseBody.error, "Unauthorized");
      for (const secret of ["hidden-session", "hidden-query", "hidden-password", "recursive-payload"]) assert.ok(!JSON.stringify(rows).includes(secret));
    } finally { await app.close(); }
  });

  it("does not break API responses when log storage fails", async () => {
    prisma.apiLog.create = (async () => { throw new Error("Database unavailable"); }) as typeof prisma.apiLog.create;
    prisma.apiLog.deleteMany = (async () => ({ count: 0 })) as typeof prisma.apiLog.deleteMany;
    const app = Fastify();
    await app.register(apiLogsPlugin);
    app.get("/health", async () => ({ ok: true }));
    try { assert.equal((await app.inject("/health")).statusCode, 200); }
    finally { await app.close(); }
  });
});
