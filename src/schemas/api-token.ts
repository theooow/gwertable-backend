import { z } from "zod";

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["READ", "WRITE"]).default("READ"),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const apiTokenParamsSchema = z.object({ id: z.string().min(1) });

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
