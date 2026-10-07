import type { Prisma, PrismaClient } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";

export type AssistantMessage = Anthropic.Beta.BetaMessageParam;
export type AssistantUsage = { inputTokens: number; outputTokens: number };

export type AssistantConversationRecord = {
  id: string;
  title: string;
  messages: AssistantMessage[];
};

const summaryFields = { id: true, title: true, createdAt: true, updatedAt: true } as const;

export class AssistantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(userId: string, workspaceId: string) {
    return this.prisma.assistantConversation.findMany({
      where: { userId, workspaceId },
      select: summaryFields,
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  }

  async find(id: string, userId: string, workspaceId: string): Promise<AssistantConversationRecord | null> {
    const conversation = await this.prisma.assistantConversation.findFirst({
      where: { id, userId, workspaceId },
      select: { id: true, title: true, messages: true },
    });
    // The column only ever stores message params written by this repository.
    return conversation && { ...conversation, messages: conversation.messages as unknown as AssistantMessage[] };
  }

  create(userId: string, workspaceId: string, title: string) {
    return this.prisma.assistantConversation.create({ data: { userId, workspaceId, title }, select: { id: true, title: true } });
  }

  save(id: string, messages: AssistantMessage[], usage: AssistantUsage = { inputTokens: 0, outputTokens: 0 }) {
    return this.prisma.assistantConversation.update({
      where: { id },
      data: {
        messages: messages as unknown as Prisma.InputJsonValue,
        inputTokens: { increment: usage.inputTokens },
        outputTokens: { increment: usage.outputTokens },
      },
    });
  }

  delete(id: string, userId: string, workspaceId: string) {
    return this.prisma.assistantConversation.deleteMany({ where: { id, userId, workspaceId } });
  }
}
