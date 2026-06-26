import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { SessionDao } from "../dao/session.dao.js";
import { VerificationTokenDao } from "../dao/verification-token.dao.js";
import { WorkspaceInvitationDao } from "../dao/workspace-invitation.dao.js";
import { WorkspaceMemberDao } from "../dao/workspace-member.dao.js";
import { EventCollaboratorDao } from "../dao/event-collaborator.dao.js";
import { AuthRepository } from "../repositories/auth.repository.js";
import { AuthService } from "../services/auth.service.js";

const loginLinkSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  inviteToken: z.string().optional(),
});

const loginOptionsSchema = loginLinkSchema;

const verifySchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  token: z.string().min(1),
  inviteToken: z.string().optional(),
});

const verifyCodeSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  code: z.string().regex(/^\d{6}$/),
  inviteToken: z.string().optional(),
});

const passwordLoginSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
  inviteToken: z.string().optional(),
});

const setupPasswordSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  token: z.string().min(1),
  password: z.string().min(8),
});

const service = new AuthService(
  new AuthRepository(
    new SessionDao(prisma),
    new VerificationTokenDao(prisma),
    new WorkspaceInvitationDao(prisma),
    new WorkspaceMemberDao(prisma),
    new EventCollaboratorDao(prisma),
    prisma,
  ),
);

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/auth/login-options", async (request) => {
    const { email, inviteToken } = loginOptionsSchema.parse(request.body);
    return service.getLoginOptions(email, inviteToken, env.FRONTEND_URL);
  });

  fastify.post("/api/auth/login-link", async (request) => {
    const { email, inviteToken } = loginLinkSchema.parse(request.body);
    const result = await service.requestLoginLink(email, inviteToken, env.FRONTEND_URL);
    fastify.log.info({ email }, "Magic login link sent");
    return result;
  });

  fastify.post("/api/auth/verify", async (_request, reply) => {
    const { email, token, inviteToken } = verifySchema.parse(_request.body);
    const session = await service.verify(email, token, inviteToken);
    return reply.send(session);
  });

  fastify.post("/api/auth/verify-code", async (_request, reply) => {
    const { email, code, inviteToken } = verifyCodeSchema.parse(_request.body);
    const session = await service.verifyCode(email, code, inviteToken);
    return reply.send(session);
  });

  fastify.post("/api/auth/password/login", async (_request, reply) => {
    const { email, password, inviteToken } = passwordLoginSchema.parse(_request.body);
    const session = await service.loginWithPassword(email, password, inviteToken);
    return reply.send(session);
  });

  fastify.post("/api/auth/password/setup", async (_request, reply) => {
    const { email, token, password } = setupPasswordSchema.parse(_request.body);
    const session = await service.setupPassword(email, token, password);
    return reply.send(session);
  });

  fastify.get("/api/auth/me", async (request) => ({
    user: request.user,
  }));

  fastify.post("/api/auth/logout", async (request) => {
    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;
    return service.logout(token);
  });
}
