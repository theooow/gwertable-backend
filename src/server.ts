import cors from "@fastify/cors";
import fastify from "fastify";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { authPlugin } from "./plugins/auth.js";
import { errorsPlugin } from "./plugins/errors.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { eventRoutes } from "./routes/events.js";
import { eventModuleRoutes } from "./routes/event-modules.js";
import { peopleRoutes } from "./routes/people.js";

const app = fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
});

await app.register(cors, {
  origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
  credentials: true,
});
await app.register(errorsPlugin);
await app.register(authPlugin);
await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(eventRoutes);
await app.register(eventModuleRoutes);
await app.register(peopleRoutes);

const shutdown = async () => {
  app.log.info("Stopping server");
  await app.close();
  await prisma.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
