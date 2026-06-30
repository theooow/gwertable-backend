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
const shortText = z.string().trim().max(120).optional().or(z.literal(""));
const addressText = z.string().trim().max(240).optional().or(z.literal(""));
const optionalEmail = z.string().trim().email().optional().or(z.literal(""));

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

const registerSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  password: z.string().min(8),
  inviteToken: z.string().optional(),
  name: shortText,
  firstName: shortText,
  lastName: shortText,
  phone: shortText,
  addressLine1: addressText,
  addressLine2: addressText,
  postalCode: shortText,
  city: shortText,
  country: shortText,
  companyName: shortText,
  companyAddressLine1: addressText,
  companyAddressLine2: addressText,
  companyPostalCode: shortText,
  companyCity: shortText,
  companyCountry: shortText,
  companySiret: shortText,
  companyVatNumber: shortText,
  billingEmail: optionalEmail,
  locale: shortText,
  currency: shortText,
  timezone: shortText,
});

function nullableString(value: string | undefined) {
  if (value === undefined) return null;
  return value || null;
}

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

  fastify.post("/api/auth/register", async (request, reply) => {
    const parsed = registerSchema.parse(request.body);
    const session = await service.register(
      {
        email: parsed.email,
        password: parsed.password,
        name: nullableString(parsed.name),
        firstName: nullableString(parsed.firstName),
        lastName: nullableString(parsed.lastName),
        phone: nullableString(parsed.phone),
        addressLine1: nullableString(parsed.addressLine1),
        addressLine2: nullableString(parsed.addressLine2),
        postalCode: nullableString(parsed.postalCode),
        city: nullableString(parsed.city),
        country: nullableString(parsed.country),
        companyName: nullableString(parsed.companyName),
        companyAddressLine1: nullableString(parsed.companyAddressLine1),
        companyAddressLine2: nullableString(parsed.companyAddressLine2),
        companyPostalCode: nullableString(parsed.companyPostalCode),
        companyCity: nullableString(parsed.companyCity),
        companyCountry: nullableString(parsed.companyCountry),
        companySiret: nullableString(parsed.companySiret),
        companyVatNumber: nullableString(parsed.companyVatNumber),
        billingEmail: nullableString(parsed.billingEmail),
        locale: parsed.locale || "fr-FR",
        currency: parsed.currency || "EUR",
        timezone: parsed.timezone || "Europe/Paris",
      },
      parsed.inviteToken,
    );
    return reply.status(201).send(session);
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
