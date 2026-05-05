import fp from "fastify-plugin";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export const errorsPlugin = fp(async (fastify) => {
  fastify.setErrorHandler((error, _request, reply) => {
    const err = error instanceof Error ? error : new Error(String(error));

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        issues: error.issues,
      });
    }

    if (err.name === "UnauthorizedError") {
      return reply.status(401).send({ error: "Unauthorized", message: err.message });
    }

    if (err.name === "ForbiddenError") {
      return reply.status(403).send({ error: "Forbidden", message: err.message });
    }

    if (err.name === "NotFoundError") {
      return reply.status(404).send({ error: "NotFound", message: err.message });
    }

    if (err.name === "ConflictError") {
      return reply.status(409).send({ error: "Conflict", message: err.message });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return reply.status(404).send({ error: "NotFound", message: "Ressource introuvable" });
    }

    fastify.log.error(error);
    return reply.status(500).send({ error: "InternalServerError" });
  });
});
