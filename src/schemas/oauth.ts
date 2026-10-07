import { z } from "zod";

export const oauthRegisterSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  token_endpoint_auth_method: z.enum(["none"]).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

export const oauthAuthorizeQuerySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  scope: z.string().optional(),
  state: z.string().max(1024).optional(),
  resource: z.string().optional(),
});

export const oauthDecisionSchema = oauthAuthorizeQuerySchema.extend({
  approve: z.boolean(),
  allowWrite: z.boolean().default(false),
});

export const oauthTokenSchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    redirect_uri: z.string().url(),
    client_id: z.string().min(1),
    code_verifier: z.string().min(43).max(128),
    resource: z.string().optional(),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
    scope: z.string().optional(),
    resource: z.string().optional(),
  }),
]);

export const oauthGrantParamsSchema = z.object({ id: z.string().min(1) });

export type OAuthAuthorizeQuery = z.infer<typeof oauthAuthorizeQuerySchema>;
