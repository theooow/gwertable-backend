import cors from "@fastify/cors";
import fastify from "fastify";
import { env } from "./env.js";
import { authPlugin } from "./plugins/auth.js";
import { errorsPlugin } from "./plugins/errors.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { eventRoutes } from "./routes/events.js";
import { eventModuleRoutes } from "./routes/event-modules.js";
import { peopleRoutes } from "./routes/people.js";
import { shotgunRoutes } from "./routes/shotgun.js";
import { workspaceRoutes } from "./routes/workspace.js";

export async function buildApp() {
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
  await app.register(shotgunRoutes);
  await app.register(workspaceRoutes);

  return app;
}
