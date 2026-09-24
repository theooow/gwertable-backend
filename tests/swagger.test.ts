import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import ts from "typescript";
import { OpenAPIV3 } from "openapi-types";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { isPublicRoute } from "../src/plugins/auth.js";
import { routeDocs } from "../src/openapi/schemas.js";
import { additionalDocs } from "../src/openapi/additional.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let spec: OpenAPIV3.Document;
const originalCreate = prisma.apiLog.create;
const originalDeleteMany = prisma.apiLog.deleteMany;
before(async () => {
  prisma.apiLog.deleteMany = (async () => ({ count: 0 })) as typeof prisma.apiLog.deleteMany;
  prisma.apiLog.create = (async () => ({})) as unknown as typeof prisma.apiLog.create;
  app = await buildApp();
  await app.ready();
  spec = app.swagger() as OpenAPIV3.Document;
});
after(async () => { await app?.close(); prisma.apiLog.create = originalCreate; prisma.apiLog.deleteMany = originalDeleteMany; });

async function files(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
}

test("every application route has a documented operation and all its request inputs", async () => {
  const registered = new Set<string>();
  const operationIds = new Set<string>();
  for (const file of await files("src/routes")) {
    const source = await readFile(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["get", "post", "put", "patch", "delete"].includes(node.expression.name.text)) {
        const path = node.arguments[0];
        if (path && (ts.isStringLiteral(path) || ts.isTemplateExpression(path)) && path.getText(ast).includes("/")) {
          const paths = ts.isStringLiteral(path) ? [path.text] : ["shifts", "services"].map(resource => path.getText(ast).slice(1,-1).replace("${resource}", resource));
          const method = node.expression.name.text;
          for (const url of paths) {
            const key = `${method.toUpperCase()} ${url}`;
            registered.add(key);
            assert.ok(app.hasRoute({ method: method.toUpperCase() as "GET", url }), key);
            const operation = spec.paths[url.replace(/:([A-Za-z0-9_]+)/g, "{$1}")]?.[method as OpenAPIV3.HttpMethods];
            assert.ok(operation?.summary, `Missing summary: ${key}`);
            assert.ok(operation.tags?.length, `Missing tag: ${key}`);
            assert.ok(operation.operationId && !operationIds.has(operation.operationId), `Missing or duplicated operationId: ${key}`);
            operationIds.add(operation.operationId);
            assert.deepEqual(operation.security, isPublicRoute(url) ? [] : [{ bearerAuth: [] }, { cookieAuth: [] }], key);
            const handler = node.arguments.at(-1)!.getText(ast);
            if (/\b(?:req|request|_request)\.body\b/.test(handler)) assert.ok(operation.requestBody, `Missing body: ${key}`);
            if (/\b(?:req|request|_request)\.query\b/.test(handler)) assert.ok(operation.parameters?.some(p => "in" in p && p.in === "query"), `Missing query: ${key}`);
            const params = operation.parameters?.filter((p): p is OpenAPIV3.ParameterObject => "in" in p && p.in === "path") ?? [];
            assert.deepEqual(params.map(p => p.name).sort(), [...url.matchAll(/:([A-Za-z0-9_]+)/g)].map(m => m[1]).sort(), key);
            assert.ok(params.every(p => p.required), key);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.deepEqual(new Set(Object.keys({ ...routeDocs, ...additionalDocs })), registered, "Remove obsolete documentation and document new routes");
  assert.equal(Object.values(spec.paths).reduce((count, item) => count + Object.keys(item!).length, 0), registered.size);
});

function body(path: string, method: OpenAPIV3.HttpMethods) {
  return (spec.paths[path]![method]!.requestBody as OpenAPIV3.RequestBodyObject).content["application/json"].schema as OpenAPIV3.SchemaObject;
}

test("generated inputs reflect real validation, optional fields, unions and nested arrays", () => {
  const login = body("/api/auth/password/login", OpenAPIV3.HttpMethods.POST);
  assert.deepEqual(login.required, ["email", "password"]);
  assert.equal((login.properties!.email as OpenAPIV3.SchemaObject).format, "email");
  const item = body("/api/equipment", OpenAPIV3.HttpMethods.POST);
  assert.ok(item.properties!.vatRateBasisPoints);
  assert.ok(!item.required!.includes("quantity"));
  const patch = body("/api/equipment/{id}", OpenAPIV3.HttpMethods.PATCH);
  assert.equal(patch.required, undefined);
  assert.equal(patch.additionalProperties, false);
  const usage = body("/api/events/{eventId}/equipment", OpenAPIV3.HttpMethods.POST);
  assert.equal((usage.oneOf ?? usage.anyOf)!.length, 2);
  const batch = body("/api/events/{eventId}/volunteers/shifts/batch", OpenAPIV3.HttpMethods.POST);
  assert.equal((batch.properties!.shift as OpenAPIV3.SchemaObject).type, "object");
  const planning = body("/api/public/volunteers/portal/{token}/planning", OpenAPIV3.HttpMethods.PATCH);
  assert.equal((planning.properties!.shifts as OpenAPIV3.ArraySchemaObject).type, "array");
  const signature = body("/api/public/volunteers/contracts/{token}/sign", OpenAPIV3.HttpMethods.POST);
  assert.deepEqual(signature.required, ["code", "documentHash", "name", "consent"]);
});

test("Swagger is served publicly, uses the current server and documents file responses", async () => {
  const result = await app.inject({ method: "GET", url: "/docs/json" });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json().servers, [{ url: "/", description: "Serveur courant" }]);
  for (const [url, type] of [["/api/finance/invoices/{id}/pdf", "application/pdf"], ["/api/events/{eventId}/tasks/calendar.ics", "text/calendar"]]) {
    const response = spec.paths[url]!.get!.responses[200] as OpenAPIV3.ResponseObject;
    assert.ok(response.content?.[type]);
  }
  assert.equal((await app.inject({ method: "GET", url: "/api/auth/me" })).statusCode, 401);
  for (const url of ["/api/events/{eventId}/volunteers/contracts/{id}/{format}", "/api/people/{personId}/volunteers/contracts/{id}/{format}", "/api/public/volunteers/contracts/{token}/{format}"]) {
    const operation = spec.paths[url]!.get!;
    const response = operation.responses[200] as OpenAPIV3.ResponseObject;
    assert.ok(response.content?.["application/pdf"], url);
    assert.ok(response.content?.["application/json"], url);
    const format = operation.parameters!.find((p): p is OpenAPIV3.ParameterObject => "name" in p && p.name === "format")!;
    assert.deepEqual((format.schema as OpenAPIV3.SchemaObject).enum, ["source", "pdf", "proof"]);
  }
});
