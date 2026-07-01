import { env } from "./env.js";
import { buildApp } from "./app.js";
import { prisma } from "./prisma.js";
import { startNotificationWorker } from "./workers/notification-worker.js";

const app = await buildApp();
const notificationWorker = startNotificationWorker(prisma, app.log);

const shutdown = async () => {
  app.log.info("Stopping server");
  notificationWorker.stop();
  await app.close();
  await prisma.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
