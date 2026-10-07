import { z } from "zod";

export const assistantMessageSchema = z.object({
  conversationId: z.string().min(1).optional(),
  content: z.string().trim().min(1).max(8000),
});

export const assistantConfirmSchema = z.object({ approve: z.boolean() });

export const assistantConversationParamsSchema = z.object({ id: z.string().min(1) });
