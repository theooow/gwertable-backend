import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { executeOperation, getOperations, searchOperations, truncate, type Operation, type OperationInput } from "./operations.js";

export type McpContext = {
  app: FastifyInstance;
  /** Headers replayed on every internal call (Authorization and/or Cookie of the MCP request). */
  credentials: Record<string, string>;
  canWrite: boolean;
};

const INSTRUCTIONS = `Abregi est un outil de gestion d'événements pour associations et collectifs : événements, budget (dépenses, revenus, billetterie), bénévoles, tâches, conducteur, matériel, courses, contacts et comptabilité.
Chaque appel agit au nom de l'utilisateur connecté, avec ses droits, dans son espace de travail courant.
Méthode : 1) search_operations pour trouver l'opération (mots-clés français ou tag) ; 2) describe_operation pour connaître ses paramètres et son corps ; 3) call_read_operation ou call_write_operation.
Les identifiants se récupèrent avec les opérations de liste (ex. GET /api/events). Les montants suffixés Cents sont en centimes. Les envois d'email, suppressions et clôtures sont réels : confirmez avec l'utilisateur avant toute écriture importante.`;

const queryValue = z.union([z.string(), z.number(), z.boolean()]);
const operationShape = {
  operationId: z.string().describe("Identifiant renvoyé par search_operations"),
  pathParams: z.record(z.string(), z.string()).optional().describe("Paramètres de chemin, ex. { \"eventId\": \"...\" }"),
  query: z.record(z.string(), z.union([queryValue, z.array(queryValue)])).optional().describe("Paramètres de requête"),
};

function text(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: truncate(typeof value === "string" ? value : JSON.stringify(value)) }], isError };
}

function describe(operation: Operation) {
  return {
    ...operation,
    parameters: operation.parameters.map(({ name, in: location, required, schema, description }) => ({ name, in: location, required: required ?? false, schema, description })),
  };
}

export function createMcpServer({ app, credentials, canWrite }: McpContext): McpServer {
  const server = new McpServer({ name: "abregi", title: "Abregi", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  async function run(operationId: string, input: OperationInput, write: boolean): Promise<CallToolResult> {
    const operation = getOperations(app).get(operationId);
    if (!operation) return text(`Opération inconnue : ${operationId}. Utilisez search_operations.`, true);
    if ((operation.method !== "GET") !== write) {
      return text(`${operationId} est une opération ${operation.method} : utilisez ${write ? "call_read_operation" : "call_write_operation"}.`, true);
    }
    try {
      const result = await executeOperation(app, credentials, operation, input);
      return text(result, result.status >= 400);
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true);
    }
  }

  server.registerTool("whoami", {
    title: "Utilisateur courant",
    description: "Retourne l'utilisateur connecté, son espace de travail, son rôle et s'il peut modifier des données.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const result = await app.inject({ method: "GET", url: "/api/auth/me", headers: credentials });
    return text({ ...result.json<object>(), canWrite }, result.statusCode >= 400);
  });

  server.registerTool("search_operations", {
    title: "Rechercher une opération",
    description: "Liste les opérations disponibles de l'API Abregi (operationId | méthode chemin | tag | résumé). Sans filtre, retourne tout le catalogue.",
    inputSchema: {
      query: z.string().optional().describe("Mots-clés, tous requis, ex. \"dépenses\""),
      tag: z.string().optional().describe("Domaine exact, ex. Budget, Tâches, Bénévoles, Événements"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, tag }) => {
    const operations = searchOperations(app, { query, tag, readOnly: !canWrite });
    if (!operations.length) {
      const tags = [...new Set([...getOperations(app).values()].map((operation) => operation.tag))];
      return text(`Aucune opération trouvée. Tags disponibles : ${tags.join(", ")}`);
    }
    return text(operations.map((operation) => `${operation.operationId} | ${operation.method} ${operation.path} | ${operation.tag} | ${operation.summary}`).join("\n"));
  });

  server.registerTool("describe_operation", {
    title: "Décrire une opération",
    description: "Retourne les paramètres (chemin, requête) et le schéma JSON du corps d'une opération.",
    inputSchema: { operationId: operationShape.operationId },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ operationId }) => {
    const operation = getOperations(app).get(operationId);
    return operation ? text(describe(operation)) : text(`Opération inconnue : ${operationId}`, true);
  });

  server.registerTool("call_read_operation", {
    title: "Lire des données",
    description: "Exécute une opération GET de l'API Abregi et retourne { status, body }.",
    inputSchema: operationShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ operationId, pathParams, query }) => run(operationId, { pathParams, query }, false));

  if (canWrite) {
    server.registerTool("call_write_operation", {
      title: "Modifier des données",
      description: "Exécute une opération POST, PUT, PATCH ou DELETE de l'API Abregi et retourne { status, body }. Action réelle : confirmez avec l'utilisateur si elle est irréversible.",
      inputSchema: { ...operationShape, body: z.unknown().optional().describe("Corps JSON conforme au schéma de describe_operation") },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    }, async ({ operationId, pathParams, query, body }) => run(operationId, { pathParams, query, body }, true));
  }

  return server;
}
