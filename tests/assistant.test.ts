import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../src/prisma.js";
import { useModelClient, type AssistantEvent, type ModelClient } from "../src/services/assistant.service.js";
import { eventPayload, json, request, seedAdminSession, setupTestApp } from "./helpers.js";

setupTestApp();
afterEach(() => useModelClient(null));

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.BetaContentBlock;

function toolUse(id: string, name: string, input: Record<string, unknown>): Block {
  return { type: "tool_use", id, name, input } as Block;
}

function text(value: string): Block {
  return { type: "text", text: value, citations: null } as Block;
}

/** Scripted model: returns the given turns in order and records every request. */
function scriptModel(turns: Array<{ content: Block[]; stop: Anthropic.Beta.BetaStopReason }>) {
  const calls: Params[] = [];
  const client: ModelClient = {
    stream(params) {
      calls.push(structuredClone(params));
      const turn = turns.shift();
      assert.ok(turn, "Unexpected model call");
      return {
        on(_event, listener) {
          for (const block of turn.content) if (block.type === "text") listener(block.text);
        },
        finalMessage: async () => ({
          id: `msg_${calls.length}`,
          type: "message",
          role: "assistant",
          model: "fake",
          content: turn.content,
          stop_reason: turn.stop,
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }) as unknown as Anthropic.Beta.BetaMessage,
      };
    },
  };
  useModelClient(client);
  return calls;
}

function events(body: string): AssistantEvent[] {
  return body.split("\n\n").filter((chunk) => chunk.startsWith("data: ")).map((chunk) => JSON.parse(chunk.slice(6)) as AssistantEvent);
}

/** The assistant is a Platinium feature. */
async function seedPlatiniumSession() {
  const session = await seedAdminSession();
  await prisma.user.update({ where: { id: session.user.id }, data: { usagePlan: "PLATINIUM" } });
  return session;
}

async function send(authorization: string, content: string, conversationId?: string) {
  const response = await request("POST", "/api/assistant/messages", authorization, { content, conversationId });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers["content-type"]), /text\/event-stream/);
  return events(response.body);
}

test("the assistant is disabled without an Anthropic API key and closed to API tokens", async () => {
  const { authorization } = await seedAdminSession();
  assert.equal(json<{ enabled: boolean }>(await request("GET", "/api/assistant/conversations", authorization)).enabled, false);
  assert.equal((await request("POST", "/api/assistant/messages", authorization, { content: "Bonjour" })).statusCode, 503);

  const token = json<{ token: string }>(await request("POST", "/api/account/api-tokens", authorization, { name: "Agent", scope: "WRITE" })).token;
  scriptModel([]);
  assert.equal((await request("POST", "/api/assistant/messages", `Bearer ${token}`, { content: "Bonjour" })).statusCode, 403);
});

test("the assistant is reserved to the Platinium plan", async () => {
  const { authorization } = await seedAdminSession();
  scriptModel([]);
  assert.equal(json<{ enabled: boolean }>(await request("GET", "/api/assistant/conversations", authorization)).enabled, false);
  const response = await request("POST", "/api/assistant/messages", authorization, { content: "Bonjour" });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /Platinium/);
});

test("the assistant reads data through the API and keeps an append-only history", async () => {
  const { authorization } = await seedPlatiniumSession();
  await request("POST", "/api/events", authorization, eventPayload);
  const calls = scriptModel([
    { content: [toolUse("t1", "call_read_operation", { operationId: "get_api_events" })], stop: "tool_use" },
    { content: [text("Tu as un événement : Release Party.")], stop: "end_turn" },
  ]);

  const stream = await send(authorization, "Quels sont mes événements ?");
  const conversation = stream.find((event) => event.type === "conversation");
  assert.ok(conversation);
  assert.deepEqual(stream.filter((event) => event.type === "tool").map((event) => event.type === "tool" && event.name), ["call_read_operation"]);
  assert.equal(stream.at(-1)?.type, "done");

  assert.equal(calls[0].model, "claude-opus-5-5");
  assert.equal(calls[0].fallbacks, "default");
  assert.ok(calls[0].tools?.some((tool) => "name" in tool && tool.name === "call_write_operation"));
  const firstTurn = calls[0].messages[0].content as Anthropic.Beta.BetaTextBlockParam[];
  assert.match(firstTurn[0].text, /<contexte>.*Test workspace/);
  // The second request replays the first one unchanged, then appends the tool result.
  assert.deepEqual(calls[1].messages.slice(0, 1), calls[0].messages);
  const toolResult = (calls[1].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
  assert.equal(toolResult.tool_use_id, "t1");
  assert.match(String(toolResult.content), /Release Party/);

  const transcript = json<{ items: Array<{ type: string; text?: string }>; pending: unknown[] }>(
    await request("GET", `/api/assistant/conversations/${conversation.id}`, authorization),
  );
  assert.deepEqual(transcript.items.map((item) => item.type), ["user", "tool", "assistant"]);
  assert.equal(transcript.items[0].text, "Quels sont mes événements ?");
  assert.deepEqual(transcript.pending, []);
  const stored = await prisma.assistantConversation.findUniqueOrThrow({ where: { id: conversation.id } });
  assert.equal(stored.inputTokens, 20);
});

test("writes wait for the user's approval and declined writes are never executed", async () => {
  const { authorization } = await seedPlatiniumSession();
  const createEvent = toolUse("w1", "call_write_operation", { operationId: "post_api_events", body: eventPayload });

  scriptModel([{ content: [text("Je crée l'événement."), createEvent], stop: "tool_use" }]);
  const proposed = await send(authorization, "Crée l'événement Release Party");
  const confirm = proposed.at(-1);
  assert.equal(confirm?.type, "confirm");
  assert.equal(confirm?.type === "confirm" && confirm.actions[0].summary.length > 0, true);
  const { id } = proposed.find((event) => event.type === "conversation") as { id: string };
  assert.equal(json<unknown[]>(await request("GET", "/api/events", authorization)).length, 0);
  assert.equal(json<{ pending: unknown[] }>(await request("GET", `/api/assistant/conversations/${id}`, authorization)).pending.length, 1);

  const calls = scriptModel([{ content: [text("C'est fait.")], stop: "end_turn" }]);
  const approved = await request("POST", `/api/assistant/conversations/${id}/confirm`, authorization, { approve: true });
  assert.equal(events(approved.body).at(-1)?.type, "done");
  assert.equal(json<unknown[]>(await request("GET", "/api/events", authorization)).length, 1);
  const result = (calls[0].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
  assert.equal(result.is_error, false);
  assert.equal((await request("POST", `/api/assistant/conversations/${id}/confirm`, authorization, { approve: true })).statusCode, 409);

  scriptModel([
    { content: [createEvent], stop: "tool_use" },
    { content: [text("D'accord, je n'ai rien créé.")], stop: "end_turn" },
  ]);
  await send(authorization, "Recrée-le", id);
  const declined = await request("POST", `/api/assistant/conversations/${id}/confirm`, authorization, { approve: false });
  assert.equal(events(declined.body).at(-1)?.type, "done");
  assert.equal(json<unknown[]>(await request("GET", "/api/events", authorization)).length, 1);
});

test("a new message declines pending actions and conversations are private", async () => {
  const { authorization } = await seedPlatiniumSession();
  scriptModel([{ content: [toolUse("w1", "call_write_operation", { operationId: "post_api_events", body: eventPayload })], stop: "tool_use" }]);
  const { id } = (await send(authorization, "Crée un événement")).find((event) => event.type === "conversation") as { id: string };

  const calls = scriptModel([{ content: [text("Très bien.")], stop: "end_turn" }]);
  await send(authorization, "Finalement non", id);
  const blocks = calls[0].messages.at(-1)!.content as Anthropic.Beta.BetaContentBlockParam[];
  assert.equal(blocks[0].type, "tool_result");
  assert.equal(blocks[0].type === "tool_result" && blocks[0].is_error, true);
  assert.equal(blocks.at(-1)?.type === "text" && blocks.at(-1)?.type, "text");

  const workspace = await prisma.workspace.create({ data: { name: "Autre espace" } });
  await prisma.user.create({
    data: {
      email: "other@abregi.test",
      defaultWorkspaceId: workspace.id,
      workspaceMemberships: { create: { workspaceId: workspace.id, role: "ADMIN" } },
      sessions: { create: { sessionToken: "other-session", expires: new Date(Date.now() + 3600_000) } },
    },
  });
  const outsider = "Bearer other-session";
  assert.equal((await request("GET", `/api/assistant/conversations/${id}`, outsider)).statusCode, 404);
  assert.equal((await request("DELETE", `/api/assistant/conversations/${id}`, outsider)).statusCode, 404);
  assert.equal((await request("DELETE", `/api/assistant/conversations/${id}`, authorization)).statusCode, 200);
  assert.equal((await request("GET", `/api/assistant/conversations/${id}`, authorization)).statusCode, 404);
});
