import type { FastifyInstance, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createMcpServer } from "../mcp/server.js";
import { requirePlanFeature } from "../lib/usage-plans.js";

const jsonRpcMessageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

function credentialsOf(request: FastifyRequest): Record<string, string> {
  const { authorization, cookie } = request.headers;
  return Object.fromEntries(Object.entries({ authorization, cookie }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** Stateless MCP endpoint (Streamable HTTP): one server per request, no resumable SSE stream. */
export async function mcpRoutes(fastify: FastifyInstance) {
  fastify.post("/mcp", { config: { documentation: { body: jsonRpcMessageSchema, statusCodes: [200, 202] } } }, async (request, reply) => {
    requirePlanFeature(request.user!.usagePlan, "ai.agents");
    const server = createMcpServer({ app: fastify, credentials: credentialsOf(request), canWrite: request.apiTokenScope !== "READ" });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  fastify.get("/mcp", { config: { documentation: { statusCodes: [405] } } }, async (_request, reply) => {
    return reply.status(405).header("allow", "POST").send({ error: "MethodNotAllowed", message: "Serveur MCP sans état : utilisez POST" });
  });

  fastify.delete("/mcp", { config: { documentation: { statusCodes: [405] } } }, async (_request, reply) => {
    return reply.status(405).header("allow", "POST").send({ error: "MethodNotAllowed", message: "Serveur MCP sans état : utilisez POST" });
  });
}
