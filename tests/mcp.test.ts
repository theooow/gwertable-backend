import assert from "node:assert/strict";
import { test } from "node:test";
import { eventPayload, json, request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type RpcResponse<T> = { result?: T; error?: { message: string } };

async function createToken(authorization: string, scope: "READ" | "WRITE") {
  const response = await request("POST", "/api/account/api-tokens", authorization, { name: "MCP", scope });
  return `Bearer ${json<{ token: string }>(response).token}`;
}

async function rpc<T>(authorization: string | undefined, method: string, params: Record<string, unknown> = {}) {
  const response = await request("POST", "/mcp", authorization, { jsonrpc: "2.0", id: 1, method, params }, { accept: "application/json, text/event-stream" });
  return { statusCode: response.statusCode, body: response.body ? (response.json() as RpcResponse<T>) : undefined };
}

async function callTool(authorization: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc<ToolResult>(authorization, "tools/call", { name, arguments: args });
  assert.ok(body?.result, JSON.stringify(body));
  return body.result;
}

test("MCP requires authentication and advertises server instructions", async () => {
  assert.equal((await rpc(undefined, "tools/list")).statusCode, 401);
  const { authorization } = await seedAdminSession();
  const token = await createToken(authorization, "READ");
  const { body } = await rpc<{ instructions: string; serverInfo: { name: string } }>(token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  });
  assert.equal(body?.result?.serverInfo.name, "abregi");
  assert.match(body?.result?.instructions ?? "", /search_operations/);
  assert.equal((await request("GET", "/mcp", token)).statusCode, 405);
});

test("a read-only token exposes read tools and reads through the REST API", async () => {
  const { authorization } = await seedAdminSession();
  await request("POST", "/api/events", authorization, eventPayload);
  const token = await createToken(authorization, "READ");

  const { body } = await rpc<{ tools: Array<{ name: string }> }>(token, "tools/list");
  const tools = body?.result?.tools.map((tool) => tool.name) ?? [];
  assert.ok(tools.includes("call_read_operation"));
  assert.ok(!tools.includes("call_write_operation"));

  const catalog = (await callTool(token, "search_operations", { tag: "Événements" })).content[0].text;
  assert.match(catalog, /get_api_events \| GET \/api\/events/);
  assert.doesNotMatch(catalog, /\| (POST|PUT|PATCH|DELETE) /);
  assert.doesNotMatch((await callTool(token, "search_operations")).content[0].text, /api-tokens|\/api\/admin|\/api\/auth\//);

  const events = await callTool(token, "call_read_operation", { operationId: "get_api_events" });
  assert.ok(!events.isError);
  const result = JSON.parse(events.content[0].text) as { status: number; body: Array<{ name: string }> };
  assert.equal(result.status, 200);
  assert.equal(result.body[0].name, eventPayload.name);

  const write = await callTool(token, "call_read_operation", { operationId: "post_api_events" });
  assert.ok(write.isError);
});

test("a write token creates data with the user's permissions and reports API errors", async () => {
  const { authorization } = await seedAdminSession();
  const token = await createToken(authorization, "WRITE");

  const description = JSON.parse((await callTool(token, "describe_operation", { operationId: "post_api_events" })).content[0].text) as { method: string; body: { properties: Record<string, unknown> } };
  assert.equal(description.method, "POST");
  assert.ok(description.body.properties.name);

  const created = await callTool(token, "call_write_operation", { operationId: "post_api_events", body: eventPayload });
  assert.ok(!created.isError, created.content[0].text);
  const { body: event } = JSON.parse(created.content[0].text) as { body: { id: string } };

  const fetched = await callTool(token, "call_read_operation", { operationId: "get_api_events_id", pathParams: { id: event.id } });
  assert.equal((JSON.parse(fetched.content[0].text) as { status: number }).status, 200);

  const invalid = await callTool(token, "call_write_operation", { operationId: "post_api_events", body: {} });
  assert.ok(invalid.isError);
  assert.equal((JSON.parse(invalid.content[0].text) as { status: number }).status, 400);

  const missingParam = await callTool(token, "call_read_operation", { operationId: "get_api_events_id" });
  assert.ok(missingParam.isError);
});
