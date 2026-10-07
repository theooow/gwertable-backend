import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { executeOperation, getOperations, searchOperations, truncate, type Operation, type OperationInput } from "./operations.js";

/** Tools shared by the MCP server and the in-app assistant. */
export type AgentToolContext = {
  app: FastifyInstance;
  /** Headers replayed on every internal call (Authorization and/or Cookie of the caller). */
  credentials: Record<string, string>;
  canWrite: boolean;
};

export type AgentToolResult = { text: string; isError: boolean };

export type AgentTool = {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  readOnly: boolean;
  run: (context: AgentToolContext, input: unknown) => Promise<AgentToolResult>;
};

function defineTool<Input extends z.ZodObject>(tool: Omit<AgentTool, "input" | "run"> & {
  input: Input;
  run: (context: AgentToolContext, input: z.infer<Input>) => Promise<AgentToolResult>;
}): AgentTool {
  return {
    ...tool,
    run: async (context, raw) => {
      const parsed = tool.input.safeParse(raw ?? {});
      if (!parsed.success) return result(`Paramètres invalides : ${z.prettifyError(parsed.error)}`, true);
      return tool.run(context, parsed.data);
    },
  };
}

function result(value: unknown, isError = false): AgentToolResult {
  return { text: truncate(typeof value === "string" ? value : JSON.stringify(value)), isError };
}

export const AGENT_INSTRUCTIONS = `Abregi est un outil de gestion d'événements pour associations et collectifs : événements, budget (dépenses, revenus, billetterie), bénévoles, tâches, conducteur, matériel, courses, contacts et comptabilité.
Chaque appel agit au nom de l'utilisateur connecté, avec ses droits, dans son espace de travail courant.
Méthode : 1) search_operations pour trouver l'opération (mots-clés français ou tag) ; 2) describe_operation pour connaître ses paramètres et son corps ; 3) call_read_operation ou call_write_operation.
Les identifiants se récupèrent avec les opérations de liste (ex. GET /api/events). Les montants suffixés Cents sont en centimes. Les envois d'email, suppressions et clôtures sont réels : confirmez avec l'utilisateur avant toute écriture importante.`;

const queryValue = z.union([z.string(), z.number(), z.boolean()]);
const operationId = z.string().describe("Identifiant renvoyé par search_operations");
const operationInput = z.object({
  operationId,
  pathParams: z.record(z.string(), z.string()).optional().describe("Paramètres de chemin, ex. { \"eventId\": \"...\" }"),
  query: z.record(z.string(), z.union([queryValue, z.array(queryValue)])).optional().describe("Paramètres de requête"),
});
const writeInput = operationInput.extend({
  body: z.unknown().optional().describe("Corps JSON (objet ou tableau, pas une chaîne) conforme au schéma de describe_operation"),
});

function describe(operation: Operation) {
  return {
    ...operation,
    parameters: operation.parameters.map(({ name, in: location, required, schema, description }) => ({ name, in: location, required: required ?? false, schema, description })),
  };
}

export function findOperation(app: FastifyInstance, id: string): Operation | undefined {
  return getOperations(app).get(id);
}

async function run(context: AgentToolContext, id: string, input: OperationInput, write: boolean): Promise<AgentToolResult> {
  const operation = findOperation(context.app, id);
  if (!operation) return result(`Opération inconnue : ${id}. Utilisez search_operations.`, true);
  if ((operation.method !== "GET") !== write) {
    return result(`${id} est une opération ${operation.method} : utilisez ${write ? "call_read_operation" : "call_write_operation"}.`, true);
  }
  try {
    const response = await executeOperation(context.app, context.credentials, operation, input);
    return result(response, response.status >= 400);
  } catch (error) {
    return result(error instanceof Error ? error.message : String(error), true);
  }
}

const tools: AgentTool[] = [
  defineTool({
    name: "whoami",
    title: "Utilisateur courant",
    description: "Retourne l'utilisateur connecté, son espace de travail, son rôle et s'il peut modifier des données.",
    input: z.object({}),
    readOnly: true,
    run: async (context) => {
      const response = await context.app.inject({ method: "GET", url: "/api/auth/me", headers: context.credentials });
      return result({ ...response.json<object>(), canWrite: context.canWrite }, response.statusCode >= 400);
    },
  }),
  defineTool({
    name: "search_operations",
    title: "Rechercher une opération",
    description: "Liste les opérations disponibles de l'API Abregi (operationId | méthode chemin | tag | résumé). Sans filtre, retourne tout le catalogue.",
    input: z.object({
      query: z.string().optional().describe("Mots-clés, tous requis, ex. \"dépenses\""),
      tag: z.string().optional().describe("Domaine exact, ex. Budget, Tâches, Bénévoles, Événements"),
    }),
    readOnly: true,
    run: async (context, { query, tag }) => {
      const operations = searchOperations(context.app, { query, tag, readOnly: !context.canWrite });
      if (!operations.length) {
        const tags = [...new Set([...getOperations(context.app).values()].map((operation) => operation.tag))];
        return result(`Aucune opération trouvée. Tags disponibles : ${tags.join(", ")}`);
      }
      return result(operations.map((operation) => `${operation.operationId} | ${operation.method} ${operation.path} | ${operation.tag} | ${operation.summary}`).join("\n"));
    },
  }),
  defineTool({
    name: "describe_operation",
    title: "Décrire une opération",
    description: "Retourne les paramètres (chemin, requête) et le schéma JSON du corps d'une opération.",
    input: z.object({ operationId }),
    readOnly: true,
    run: async (context, input) => {
      const operation = findOperation(context.app, input.operationId);
      return operation ? result(describe(operation)) : result(`Opération inconnue : ${input.operationId}`, true);
    },
  }),
  defineTool({
    name: "call_read_operation",
    title: "Lire des données",
    description: "Exécute une opération GET de l'API Abregi et retourne { status, body }.",
    input: operationInput,
    readOnly: true,
    run: (context, { operationId: id, pathParams, query }) => run(context, id, { pathParams, query }, false),
  }),
  defineTool({
    name: "call_write_operation",
    title: "Modifier des données",
    description: "Exécute une opération POST, PUT, PATCH ou DELETE de l'API Abregi et retourne { status, body }. Action réelle : confirmez avec l'utilisateur si elle est irréversible.",
    input: writeInput,
    readOnly: false,
    run: (context, { operationId: id, pathParams, query, body }) => run(context, id, { pathParams, query, body }, true),
  }),
];

export function agentTools(canWrite: boolean): AgentTool[] {
  return canWrite ? tools : tools.filter((tool) => tool.readOnly);
}
