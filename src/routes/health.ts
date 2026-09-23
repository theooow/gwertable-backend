import type { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", { config: { documentation: {  } } }, async () => ({
    status: "ok",
    service: "abregi-backend",
  }));
}
