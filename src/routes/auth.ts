import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { prisma } from "../prisma.js";

const loginLinkSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
});

const verifySchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  token: z.string().min(1),
});

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

async function findOrCreateUser(email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  const person = await prisma.person.findUnique({ where: { email } });
  return prisma.user.create({
    data: {
      email,
      role: "VIEWER",
      personId: person?.id,
    },
  });
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/auth/login-link", async (request) => {
    const { email } = loginLinkSchema.parse(request.body);
    const token = randomToken();
    const expires = new Date(Date.now() + env.AUTH_TOKEN_TTL_MINUTES * 60 * 1000);

    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
      },
    });

    const url = new URL("/login/verify", env.FRONTEND_URL);
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);

    fastify.log.info({ email, url: url.toString() }, "Magic login link created");

    return {
      ok: true,
      email,
      devVerificationUrl: url.toString(),
    };
  });

  fastify.post("/api/auth/verify", async (request, reply) => {
    const { email, token } = verifySchema.parse(request.body);

    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token },
    });

    if (
      !verificationToken ||
      verificationToken.identifier !== email ||
      verificationToken.expires <= new Date()
    ) {
      const error = new Error("Lien de connexion invalide ou expire");
      error.name = "UnauthorizedError";
      throw error;
    }

    await prisma.verificationToken.delete({
      where: { token },
    });

    const user = await findOrCreateUser(email);
    const sessionToken = randomToken();
    const expires = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires,
      },
    });

    return reply.send({
      sessionToken,
      expires: expires.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        personId: user.personId,
      },
    });
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

    if (token) {
      await prisma.session.deleteMany({ where: { sessionToken: token } });
    }

    return { ok: true };
  });
}
