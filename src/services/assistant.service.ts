import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../env.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { AGENT_INSTRUCTIONS, agentTools, findOperation, type AgentTool, type AgentToolContext } from "../mcp/tools.js";
import type { AssistantMessage, AssistantRepository, AssistantUsage } from "../repositories/assistant.repository.js";

type MessageParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;
type ToolUse = Anthropic.Beta.BetaToolUseBlock;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/** Narrow view of the SDK stream, so tests can substitute the model. */
export type ModelStream = {
  on(event: "text", listener: (delta: string) => void): unknown;
  finalMessage(): Promise<Message>;
};
export type ModelClient = { stream(params: MessageParams, options: { signal: AbortSignal }): ModelStream };

export type PendingAction = { id: string; method: string; path: string; summary: string; body?: unknown };

export type AssistantEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; label: string }
  | { type: "confirm"; actions: PendingAction[] }
  | { type: "done" }
  | { type: "error"; message: string };

export type TranscriptItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; label: string };

export type AssistantCaller = AgentToolContext & {
  userId: string;
  workspaceId: string;
  /** Who the assistant talks to; written once in the first user turn to keep the prompt prefix cacheable. */
  context: string;
};

const TOOL_RESULT_MAX_CHARS = 30_000;
const MAX_JSON_RETRIES = 2;
const DECLINED = "L'utilisateur a refusé cette action. Ne la relance pas sans nouvelle demande de sa part.";

const SYSTEM_PROMPT = `Tu es l'assistant intégré à Abregi. Tu aides l'utilisateur à consulter et à gérer ses événements en utilisant l'API de l'application à sa place.

${AGENT_INSTRUCTIONS}

Toute modification (call_write_operation) est soumise à la validation de l'utilisateur dans l'interface avant d'être exécutée : appelle directement l'outil quand l'utilisateur a demandé l'action, sans redemander son accord par écrit. Si une action est refusée, prends-en acte.
Réponds en français, de façon concise, en Markdown simple. Affiche les montants en euros et les dates en toutes lettres.

Tes interlocuteurs sont des organisateurs d'événements, pas des développeurs. Parle uniquement en termes métier (événements, dépenses, bénévoles, tâches…) : ne mentionne jamais l'API, les requêtes, les opérations, les codes ou statuts d'erreur, le JSON, les noms de champs, les formats de date, les identifiants internes ni les journaux du serveur, y compris pour expliquer un échec, et ne suggère jamais de consulter des logs ou de contacter un développeur.
Si une information manque ou si rien ne permet de faire ce qui est demandé, dis-le simplement plutôt que de deviner.
Si une action échoue :
- quand l'erreur désigne une information à corriger (valeur manquante ou invalide), demande-la à l'utilisateur avec ses mots à lui ;
- sinon, ne relance pas la même action plus d'une fois. Dis en une phrase qu'elle n'a pas pu aboutir à cause d'un problème de l'application, propose de la faire depuis l'interface ou de réessayer plus tard, et indique que l'équipe Abregi peut aider si cela persiste. Ne spécule pas sur la cause.`;

let modelClientOverride: ModelClient | null = null;
let defaultModelClient: ModelClient | null = null;

/** Test seam: replaces the Anthropic client. */
export function useModelClient(client: ModelClient | null) {
  modelClientOverride = client;
}

export function isAssistantEnabled(): boolean {
  return Boolean(modelClientOverride ?? env.ANTHROPIC_API_KEY);
}

function modelClient(): ModelClient {
  if (modelClientOverride) return modelClientOverride;
  if (!defaultModelClient) {
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    defaultModelClient = { stream: (params, options) => anthropic.beta.messages.stream(params, options) };
  }
  return defaultModelClient;
}

function toAnthropicTool(tool: AgentTool): Anthropic.Beta.BetaTool {
  const { $schema: _schema, ...schema } = z.toJSONSchema(tool.input) as Anthropic.Beta.BetaTool.InputSchema & { $schema?: string };
  return { name: tool.name, description: tool.description, input_schema: schema, eager_input_streaming: true };
}

function textOf(content: AssistantMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
}

function pendingToolUses(messages: AssistantMessage[]): ToolUse[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || typeof last.content === "string") return [];
  return last.content.filter((block): block is ToolUse => block.type === "tool_use");
}

function usageOf(message: Message): AssistantUsage {
  const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens } = message.usage;
  return { inputTokens: input_tokens + (cache_creation_input_tokens ?? 0) + (cache_read_input_tokens ?? 0), outputTokens: output_tokens };
}

export class AssistantService {
  constructor(private readonly repository: AssistantRepository) {}

  list(userId: string, workspaceId: string) {
    return this.repository.list(userId, workspaceId);
  }

  async transcript(id: string, caller: Pick<AssistantCaller, "userId" | "workspaceId" | "app">) {
    const conversation = await this.repository.find(id, caller.userId, caller.workspaceId);
    if (!conversation) throw new NotFoundError("Conversation introuvable");
    const items: TranscriptItem[] = [];
    for (const message of conversation.messages) {
      if (message.role === "system") continue;
      if (typeof message.content === "string") {
        items.push({ type: message.role, text: message.content });
        continue;
      }
      if (message.role === "user") {
        // The first block of the first turn is the caller context, never shown.
        const texts = message.content.filter((block): block is Anthropic.Beta.BetaTextBlockParam => block.type === "text" && !block.text.startsWith("<contexte>"));
        if (texts.length) items.push({ type: "user", text: texts.map((block) => block.text).join("\n\n") });
        continue;
      }
      for (const block of message.content) {
        if (block.type === "text" && block.text.trim()) items.push({ type: "assistant", text: block.text });
        if (block.type === "tool_use") items.push({ type: "tool", name: block.name, label: this.label(caller.app, block) });
      }
    }
    return {
      id: conversation.id,
      title: conversation.title,
      items,
      pending: this.pendingActions(caller.app, pendingToolUses(conversation.messages)),
    };
  }

  async delete(id: string, userId: string, workspaceId: string) {
    const { count } = await this.repository.delete(id, userId, workspaceId);
    if (!count) throw new NotFoundError("Conversation introuvable");
  }

  /** Loads (or creates) the conversation before the response starts streaming, so errors stay plain HTTP. */
  async open(caller: AssistantCaller, content: string, conversationId?: string) {
    if (conversationId) {
      const conversation = await this.repository.find(conversationId, caller.userId, caller.workspaceId);
      if (!conversation) throw new NotFoundError("Conversation introuvable");
      return { conversation, created: false };
    }
    const created = await this.repository.create(caller.userId, caller.workspaceId, content.replace(/\s+/g, " ").slice(0, 80));
    return { conversation: { ...created, messages: [] }, created: true };
  }

  async sendMessage(caller: AssistantCaller, conversation: { id: string; messages: AssistantMessage[] }, content: string, emit: (event: AssistantEvent) => void, signal: AbortSignal) {
    const messages = [...conversation.messages];
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
    // A new message while actions await approval declines them: every tool_use needs a result.
    for (const toolUse of pendingToolUses(messages)) blocks.push({ type: "tool_result", tool_use_id: toolUse.id, content: DECLINED, is_error: true });
    if (!messages.length) blocks.push({ type: "text", text: caller.context });
    blocks.push({ type: "text", text: content });
    messages.push({ role: "user", content: blocks });
    await this.repository.save(conversation.id, messages);
    await this.loop(caller, conversation.id, messages, emit, signal);
  }

  /** Loads a conversation whose last turn awaits the user's approval. */
  async openPending(caller: AssistantCaller, id: string) {
    const conversation = await this.repository.find(id, caller.userId, caller.workspaceId);
    if (!conversation) throw new NotFoundError("Conversation introuvable");
    if (!pendingToolUses(conversation.messages).length) throw new ConflictError("Aucune action en attente de validation");
    return conversation;
  }

  async confirm(caller: AssistantCaller, conversation: { id: string; messages: AssistantMessage[] }, approve: boolean, emit: (event: AssistantEvent) => void, signal: AbortSignal) {
    const messages = [...conversation.messages];
    messages.push({ role: "user", content: await this.runTools(caller, pendingToolUses(messages), approve, emit) });
    await this.repository.save(conversation.id, messages);
    await this.loop(caller, conversation.id, messages, emit, signal);
  }

  private async loop(caller: AssistantCaller, id: string, messages: AssistantMessage[], emit: (event: AssistantEvent) => void, signal: AbortSignal) {
    const tools = agentTools(caller.canWrite);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (let step = 0, jsonRetries = 0; step < env.ASSISTANT_MAX_STEPS; step++) {
      const stream = modelClient().stream({
        model: env.ASSISTANT_MODEL,
        max_tokens: 64_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: env.ASSISTANT_EFFORT },
        cache_control: { type: "ephemeral" },
        system: SYSTEM_PROMPT,
        tools: tools.map(toAnthropicTool),
        messages,
      }, { signal });
      stream.on("text", (delta) => emit({ type: "text", delta }));

      let message: Message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (error) {
        // With eager input streaming, an unparseable tool input rejects the turn: re-issue it.
        if (error instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= MAX_JSON_RETRIES) throw error;
        continue;
      }

      if (message.stop_reason === "refusal") {
        emit({ type: "error", message: "L'assistant ne peut pas répondre à cette demande." });
        return;
      }
      const toolUses = message.content.filter((block): block is ToolUse => block.type === "tool_use");
      if (message.stop_reason === "max_tokens" && toolUses.length) {
        emit({ type: "error", message: "Réponse trop longue, interrompue. Reformule ta demande plus précisément." });
        return;
      }

      messages.push({ role: "assistant", content: message.content });
      await this.repository.save(id, messages, usageOf(message));

      if (message.stop_reason === "pause_turn") continue;
      if (!toolUses.length) {
        emit({ type: "done" });
        return;
      }

      if (toolUses.some((toolUse) => byName.get(toolUse.name)?.readOnly === false)) {
        emit({ type: "confirm", actions: this.pendingActions(caller.app, toolUses) });
        return;
      }

      messages.push({ role: "user", content: await this.runTools(caller, toolUses, false, emit) });
      await this.repository.save(id, messages);
    }

    emit({ type: "error", message: "L'assistant a atteint le nombre maximal d'étapes pour cette demande." });
  }

  private async runTools(caller: AssistantCaller, toolUses: ToolUse[], approveWrites: boolean, emit: (event: AssistantEvent) => void): Promise<ToolResult[]> {
    const byName = new Map(agentTools(caller.canWrite).map((tool) => [tool.name, tool]));
    return Promise.all(toolUses.map(async (toolUse): Promise<ToolResult> => {
      const tool = byName.get(toolUse.name);
      if (!tool) return { type: "tool_result", tool_use_id: toolUse.id, content: `Outil inconnu : ${toolUse.name}`, is_error: true };
      if (!tool.readOnly && !approveWrites) return { type: "tool_result", tool_use_id: toolUse.id, content: DECLINED, is_error: true };
      emit({ type: "tool", name: toolUse.name, label: this.label(caller.app, toolUse) });
      const { text, isError } = await tool.run(caller, toolUse.input);
      const content = text.length > TOOL_RESULT_MAX_CHARS ? `${text.slice(0, TOOL_RESULT_MAX_CHARS)}\n… [résultat tronqué, affinez la requête]` : text;
      return { type: "tool_result", tool_use_id: toolUse.id, content, is_error: isError };
    }));
  }

  private label(app: AgentToolContext["app"], toolUse: Pick<ToolUse, "name" | "input">): string {
    const input = toolUse.input as { operationId?: unknown; query?: unknown };
    if (typeof input.operationId === "string") {
      const operation = findOperation(app, input.operationId);
      if (operation) return operation.summary;
    }
    if (toolUse.name === "search_operations") return "Recherche des fonctionnalités disponibles";
    if (toolUse.name === "whoami") return "Lecture du profil";
    return toolUse.name;
  }

  private pendingActions(app: AgentToolContext["app"], toolUses: ToolUse[]): PendingAction[] {
    return toolUses.filter((toolUse) => toolUse.name === "call_write_operation").map((toolUse) => {
      const input = toolUse.input as { operationId?: string; pathParams?: Record<string, string>; body?: unknown };
      const operation = input.operationId ? findOperation(app, input.operationId) : undefined;
      const path = (operation?.path ?? input.operationId ?? "").replace(/:([A-Za-z0-9_]+)/g, (match, name: string) => input.pathParams?.[name] ?? match);
      return { id: toolUse.id, method: operation?.method ?? "?", path, summary: operation?.summary ?? "Opération inconnue", body: input.body };
    });
  }
}
