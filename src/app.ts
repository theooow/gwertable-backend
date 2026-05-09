import cors from "@fastify/cors";
import fastify from "fastify";
import { env } from "./env.js";
import { authPlugin } from "./plugins/auth.js";
import { errorsPlugin } from "./plugins/errors.js";
import { swaggerPlugin } from "./plugins/swagger.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { eventRoutes } from "./routes/events.js";
import { eventModuleRoutes } from "./routes/event-modules.js";
import { participantRoutes } from "./routes/event-modules/participants.js";
import { taskRoutes } from "./routes/event-modules/tasks.js";
import { runOfShowRoutes } from "./routes/event-modules/run-of-show.js";
import { budgetRoutes } from "./routes/event-modules/budget.js";
import { shoppingRoutes } from "./routes/event-modules/shopping.js";
import { equipmentEventRoutes } from "./routes/event-modules/equipment-event.js";
import { uploadRoutes } from "./routes/event-modules/uploads.js";
import { peopleRoutes } from "./routes/people.js";
import { shotgunRoutes } from "./routes/shotgun.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { equipmentRoutes } from "./routes/equipment.js";

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
  await app.register(swaggerPlugin);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(eventRoutes);
  await app.register(eventModuleRoutes);
  await app.register(participantRoutes);
  await app.register(taskRoutes);
  await app.register(runOfShowRoutes);
  await app.register(budgetRoutes);
  await app.register(shoppingRoutes);
  await app.register(equipmentEventRoutes);
  await app.register(uploadRoutes);
  await app.register(peopleRoutes);
  await app.register(shotgunRoutes);
  await app.register(workspaceRoutes);
  await app.register(equipmentRoutes);

  return app;
}
