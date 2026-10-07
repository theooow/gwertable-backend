import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../prisma.js";
import { AppError } from "../lib/errors.js";
import { planCan, requirePlanFeature } from "../lib/usage-plans.js";
import { AssistantRepository } from "../repositories/assistant.repository.js";
import { AssistantService, isAssistantEnabled, type AssistantCaller, type AssistantEvent } from "../services/assistant.service.js";
import { assistantConfirmSchema, assistantConversationParamsSchema, assistantMessageSchema } from "../schemas/assistant.js";
import { env } from "../env.js";

const service = new AssistantService(new AssistantRepository(prisma));

class AssistantDisabledError extends AppError {}

function callerOf(fastify: FastifyInstance, request: FastifyRequest): AssistantCaller {
  if (!isAssistantEnabled()) throw new AssistantDisabledError("Assistant IA non configuré");
  const user = request.user!;
  requirePlanFeature(user.usagePlan, "ai.assistant");
  const { authorization, cookie } = request.headers;
  const credentials = Object.fromEntries(Object.entries({ authorization, cookie }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const today = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: user.timezone }).format(new Date());
  return {
    app: fastify,
    credentials,
    canWrite: true,
    userId: user.id,
    workspaceId: request.workspaceId,
    context: `<contexte>Utilisateur : ${user.name ?? user.email} (${user.email}). Espace de travail : ${user.workspaceName}. Rôle : ${request.userRole}. Date : ${today} (${user.timezone}).</contexte>`,
  };
}

/** Streams assistant events as Server-Sent Events; the run is aborted if the client goes away. */
async function streamEvents(reply: FastifyReply, run: (emit: (event: AssistantEvent) => void, signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  reply.raw.on("close", () => controller.abort());
  const emit = (event: AssistantEvent) => {
    if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    await run(emit, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) {
      reply.log.error({ err: error }, "Assistant run failed");
      emit({ type: "error", message: "L'assistant a rencontré une erreur. Réessaie dans un instant." });
    }
  } finally {
    reply.raw.end();
  }
}

export async function assistantRoutes(fastify: FastifyInstance) {
  fastify.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AssistantDisabledError) return reply.status(503).send({ error: "ServiceUnavailable", message: error.message });
    throw error;
  });

  fastify.get("/api/assistant/conversations", { config: { documentation: {} } }, async (request) => ({
    enabled: isAssistantEnabled() && planCan(request.user!.usagePlan, "ai.assistant"),
    model: env.ASSISTANT_MODEL,
    conversations: await service.list(request.user!.id, request.workspaceId),
  }));

  fastify.get("/api/assistant/conversations/:id", { config: { documentation: { params: assistantConversationParamsSchema } } }, async (request) => {
    const { id } = assistantConversationParamsSchema.parse(request.params);
    return service.transcript(id, { app: fastify, userId: request.user!.id, workspaceId: request.workspaceId });
  });

  fastify.delete("/api/assistant/conversations/:id", { config: { documentation: { params: assistantConversationParamsSchema } } }, async (request) => {
    const { id } = assistantConversationParamsSchema.parse(request.params);
    await service.delete(id, request.user!.id, request.workspaceId);
    return { ok: true };
  });

  fastify.post("/api/assistant/messages", { config: { documentation: { body: assistantMessageSchema } } }, async (request, reply) => {
    const { conversationId, content } = assistantMessageSchema.parse(request.body);
    const caller = callerOf(fastify, request);
    const { conversation, created } = await service.open(caller, content, conversationId);
    await streamEvents(reply, async (emit, signal) => {
      if (created) emit({ type: "conversation", id: conversation.id, title: conversation.title });
      await service.sendMessage(caller, conversation, content, emit, signal);
    });
  });

  fastify.post("/api/assistant/conversations/:id/confirm", { config: { documentation: { params: assistantConversationParamsSchema, body: assistantConfirmSchema } } }, async (request, reply) => {
    const { id } = assistantConversationParamsSchema.parse(request.params);
    const { approve } = assistantConfirmSchema.parse(request.body);
    const caller = callerOf(fastify, request);
    const conversation = await service.openPending(caller, id);
    await streamEvents(reply, (emit, signal) => service.confirm(caller, conversation, approve, emit, signal));
  });
}
