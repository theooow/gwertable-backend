import { env } from "./env.js";
import { buildApp } from "./app.js";
import { prisma } from "./prisma.js";

const app = await buildApp();

const shutdown = async () => {
  app.log.info("Stopping server");
  await app.close();
  await prisma.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
