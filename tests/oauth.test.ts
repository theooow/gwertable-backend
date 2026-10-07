import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../src/prisma.js";
import { json, request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();

const verifier = "a".repeat(20) + "-verifier-with-enough-entropy-1234567890";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
const form = { "content-type": "application/x-www-form-urlencoded" };
const mcpHeaders = { accept: "application/json, text/event-stream" };

async function register(redirectUris = [redirectUri]) {
  const response = await request("POST", "/oauth/register", undefined, { client_name: "ChatGPT", redirect_uris: redirectUris });
  return { response, clientId: response.statusCode === 201 ? json<{ client_id: string }>(response).client_id : "" };
}

function authorizeQuery(clientId: string, uri = redirectUri) {
  return { client_id: clientId, redirect_uri: uri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "read write", state: "xyz" };
}

async function authorize(authorization: string, clientId: string, allowWrite = true, uri = redirectUri) {
  const response = await request("POST", "/api/oauth/authorize", authorization, { ...authorizeQuery(clientId, uri), approve: true, allowWrite });
  assert.equal(response.statusCode, 200, response.body);
  return new URL(json<{ redirectTo: string }>(response).redirectTo);
}

async function exchange(code: string, clientId: string, codeVerifier = verifier, uri = redirectUri) {
  return request("POST", "/oauth/token", undefined, new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: uri, client_id: clientId, code_verifier: codeVerifier }).toString(), form);
}

test("metadata advertises the authorization server and /mcp challenges unauthenticated clients", async () => {
  const resource = json<{ resource: string; authorization_servers: string[] }>(await request("GET", "/.well-known/oauth-protected-resource/mcp"));
  assert.equal(resource.resource, "http://localhost:3000/mcp");
  assert.deepEqual(resource.authorization_servers, ["http://localhost:3000"]);
  const server = json<Record<string, unknown>>(await request("GET", "/.well-known/oauth-authorization-server"));
  assert.equal(server.authorization_endpoint, "http://localhost:3000/oauth/authorize");
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);

  const unauthenticated = await request("POST", "/mcp", undefined, { jsonrpc: "2.0", id: 1, method: "tools/list" }, mcpHeaders);
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.headers["www-authenticate"], 'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"');
});

test("a Platinium user connects an AI agent end to end with PKCE and rotating refresh tokens", async () => {
  const { authorization } = await seedAdminSession("PLATINIUM");
  const { clientId } = await register();

  const preview = await request("GET", `/api/oauth/authorize?${new URLSearchParams(authorizeQuery(clientId))}`, authorization);
  assert.deepEqual(json(preview), { clientName: "ChatGPT", requestsWrite: true });

  const redirect = await authorize(authorization, clientId);
  assert.equal(redirect.origin + redirect.pathname, redirectUri);
  assert.equal(redirect.searchParams.get("state"), "xyz");
  const code = redirect.searchParams.get("code")!;

  assert.equal(json<{ error: string }>(await exchange(code, clientId, "b".repeat(50))).error, "invalid_grant");
  // The failed attempt consumed the code: it cannot be replayed.
  assert.equal((await exchange(code, clientId)).statusCode, 400);

  const second = (await authorize(authorization, clientId)).searchParams.get("code")!;
  const issued = await exchange(second, clientId);
  assert.equal(issued.statusCode, 200, issued.body);
  assert.equal(issued.headers["cache-control"], "no-store");
  const tokens = json<{ access_token: string; refresh_token: string; expires_in: number; scope: string }>(issued);
  assert.equal(tokens.scope, "read write");
  assert.equal(tokens.expires_in, 3600);

  const tools = await request("POST", "/mcp", `Bearer ${tokens.access_token}`, { jsonrpc: "2.0", id: 1, method: "tools/list" }, mcpHeaders);
  assert.equal(tools.statusCode, 200, tools.body);
  assert.match(tools.body, /call_write_operation/);

  const refreshed = await request("POST", "/oauth/token", undefined, new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }).toString(), form);
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  const rotated = json<{ access_token: string; refresh_token: string }>(refreshed);
  assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  const reused = await request("POST", "/oauth/token", undefined, new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }).toString(), form);
  assert.equal(json<{ error: string }>(reused).error, "invalid_grant");

  // OAuth access tokens never appear among personal tokens; the grant is listed and revocable instead.
  assert.equal(json<unknown[]>(await request("GET", "/api/account/api-tokens", authorization)).length, 0);
  const grants = json<Array<{ id: string; client: { name: string }; scope: string }>>(await request("GET", "/api/account/oauth-grants", authorization));
  assert.equal(grants.length, 1);
  assert.equal(grants[0].client.name, "ChatGPT");
  assert.equal((await request("DELETE", `/api/account/oauth-grants/${grants[0].id}`, authorization)).statusCode, 200);
  assert.equal((await request("GET", "/api/events", `Bearer ${rotated.access_token}`)).statusCode, 401);
});

test("authorization requests are validated and gated by plan and consent", async () => {
  const { authorization, user } = await seedAdminSession();
  assert.equal(json<{ error: string }>((await register(["http://evil.example/callback"])).response).error, "invalid_redirect_uri");
  const { clientId } = await register([redirectUri, "http://127.0.0.1:33418/callback"]);

  const wrongRedirect = await request("GET", `/api/oauth/authorize?${new URLSearchParams(authorizeQuery(clientId, "https://evil.example/cb"))}`, authorization);
  assert.equal(wrongRedirect.statusCode, 400);
  assert.equal((await request("POST", "/api/oauth/authorize", authorization, { ...authorizeQuery(clientId), approve: true, allowWrite: true })).statusCode, 403);

  await prisma.user.update({ where: { id: user.id }, data: { usagePlan: "PLATINIUM" } });
  const denied = new URL(json<{ redirectTo: string }>(await request("POST", "/api/oauth/authorize", authorization, { ...authorizeQuery(clientId), approve: false })).redirectTo);
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.get("code"), null);

  // Loopback clients may pick another port; read-only consent narrows the requested scope.
  const loopback = "http://127.0.0.1:51234/callback";
  const code = (await authorize(authorization, clientId, false, loopback)).searchParams.get("code")!;
  const tokens = json<{ access_token: string; scope: string }>(await exchange(code, clientId, verifier, loopback));
  assert.equal(tokens.scope, "read");
  assert.equal((await request("POST", "/api/events", `Bearer ${tokens.access_token}`, { name: "x" })).statusCode, 403);

  assert.equal((await request("GET", "/api/oauth/authorize?client_id=x", `Bearer ${tokens.access_token}`)).statusCode, 403);
});
