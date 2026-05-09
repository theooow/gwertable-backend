import fp from "fastify-plugin";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  EmailDeliveryError,
} from "../lib/errors.js";

/**
 * Résout le nom d'erreur, en supportant les deux mécanismes :
 * - `instanceof AppError` (nouveau — après migration d'une route)
 * - `error.name === "..."` (ancien — routes pas encore migrées)
 */
function resolveErrorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return "";
}

export const errorsPlugin = fp(async (fastify) => {
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        issues: error.issues,
      });
    }

    if (error instanceof ValidationError || resolveErrorName(error) === "ValidationError") {
      return reply.status(400).send({
        error: "ValidationError",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (error instanceof UnauthorizedError || resolveErrorName(error) === "UnauthorizedError") {
      return reply.status(401).send({
        error: "Unauthorized",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (error instanceof ForbiddenError || resolveErrorName(error) === "ForbiddenError") {
      return reply.status(403).send({
        error: "Forbidden",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (error instanceof NotFoundError || resolveErrorName(error) === "NotFoundError") {
      return reply.status(404).send({
        error: "NotFound",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (error instanceof ConflictError || resolveErrorName(error) === "ConflictError") {
      return reply.status(409).send({
        error: "Conflict",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (error instanceof EmailDeliveryError || resolveErrorName(error) === "EmailDeliveryError") {
      fastify.log.error(error);
      return reply.status(502).send({
        error: "EmailDeliveryError",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return reply.status(404).send({ error: "NotFound", message: "Ressource introuvable" });
    }

    fastify.log.error(error);
    return reply.status(500).send({ error: "InternalServerError" });
  });
});
