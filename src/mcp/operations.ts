import type { FastifyInstance } from "fastify";
import type { OpenAPIV3 } from "openapi-types";
import { isApiTokenForbiddenRoute } from "../lib/api-token.js";
import { isPublicRoute } from "../plugins/auth.js";

/**
 * Catalog of REST operations an AI agent may call, derived from the OpenAPI spec so
 * that every documented route becomes available without a hand-written tool.
 */
export type Operation = {
  operationId: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  parameters: OpenAPIV3.ParameterObject[];
  body?: OpenAPIV3.SchemaObject;
};

export type OperationInput = {
  pathParams?: Record<string, string>;
  query?: Record<string, string | number | boolean | Array<string | number | boolean>>;
  body?: unknown;
};

export type OperationResult = { status: number; body: unknown };

const EXCLUDED_TAGS = new Set(["Auth", "Administration", "Système", "Fichiers", "Suivi produit", "Essai du budget"]);
const MAX_RESPONSE_CHARS = 100_000;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function isJsonContent(content: Record<string, OpenAPIV3.MediaTypeObject> | undefined): boolean {
  return !content || Object.keys(content).every((type) => type === "application/json");
}

function isAgentOperation(method: string, path: string, operation: OpenAPIV3.OperationObject): boolean {
  if (isPublicRoute(path) || path === "/mcp" || path.startsWith("/uploads/") || path.startsWith("/calendar/")) return false;
  if (isApiTokenForbiddenRoute(method, path)) return false;
  if (operation.tags?.some((tag) => EXCLUDED_TAGS.has(tag))) return false;
  const body = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined;
  const success = operation.responses?.[200] as OpenAPIV3.ResponseObject | undefined;
  return isJsonContent(body?.content) && isJsonContent(success?.content);
}

const catalogs = new WeakMap<FastifyInstance, Map<string, Operation>>();

export function getOperations(app: FastifyInstance): Map<string, Operation> {
  const cached = catalogs.get(app);
  if (cached) return cached;

  const spec = app.swagger() as OpenAPIV3.Document;
  const operations = new Map<string, Operation>();
  for (const [openapiPath, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item?.[method];
      if (!operation?.operationId) continue;
      const path = openapiPath.replace(/\{([^}]+)\}/g, ":$1");
      if (!isAgentOperation(method.toUpperCase(), path, operation)) continue;
      const body = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined;
      operations.set(operation.operationId, {
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        tag: operation.tags?.[0] ?? "Autres",
        summary: operation.summary ?? "",
        description: operation.description,
        parameters: (operation.parameters ?? []).filter((parameter): parameter is OpenAPIV3.ParameterObject => "in" in parameter),
        body: body?.content?.["application/json"]?.schema as OpenAPIV3.SchemaObject | undefined,
      });
    }
  }
  catalogs.set(app, operations);
  return operations;
}

export function searchOperations(app: FastifyInstance, filter: { query?: string; tag?: string; readOnly?: boolean }): Operation[] {
  const words = filter.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return [...getOperations(app).values()].filter((operation) => {
    if (filter.readOnly && operation.method !== "GET") return false;
    if (filter.tag && operation.tag.toLowerCase() !== filter.tag.toLowerCase()) return false;
    const haystack = `${operation.operationId} ${operation.path} ${operation.tag} ${operation.summary} ${operation.description ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

function buildUrl(operation: Operation, input: OperationInput): string {
  const path = operation.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = input.pathParams?.[name];
    if (!value) throw new Error(`Paramètre de chemin manquant : ${name}`);
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Replays the operation through Fastify with the caller's credentials, so routing,
 * authorization, validation and activity logging behave exactly as for the web app.
 */
/** Agents sometimes serialize the body themselves: accept a JSON string as well as a value. */
function jsonPayload(body: unknown): string {
  if (typeof body === "string") {
    try {
      return JSON.stringify(JSON.parse(body));
    } catch {
      // Not JSON: sent as a JSON string so the route reports a validation error.
    }
  }
  return JSON.stringify(body);
}

export async function executeOperation(app: FastifyInstance, credentials: Record<string, string>, operation: Operation, input: OperationInput): Promise<OperationResult> {
  const hasBody = input.body !== undefined && operation.method !== "GET";
  const response = await app.inject({
    method: operation.method as "GET",
    url: buildUrl(operation, input),
    headers: hasBody ? { ...credentials, "content-type": "application/json" } : credentials,
    ...(hasBody ? { payload: jsonPayload(input.body) } : {}),
  });
  if (!response.body) return { status: response.statusCode, body: null };
  const body = String(response.headers["content-type"]).includes("application/json") ? response.json() : response.body.slice(0, MAX_RESPONSE_CHARS);
  return { status: response.statusCode, body };
}

export function truncate(text: string): string {
  return text.length > MAX_RESPONSE_CHARS ? `${text.slice(0, MAX_RESPONSE_CHARS)}\n… [réponse tronquée, affinez la requête]` : text;
}
