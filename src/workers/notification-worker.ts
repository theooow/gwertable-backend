import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { env } from "../env.js";
import { DiscordBotClient } from "../lib/discord.js";
import { ReminderWorkerService } from "../services/reminder-worker.service.js";

export function startNotificationWorker(prisma: PrismaClient, logger: FastifyBaseLogger) {
  if (!env.NOTIFICATION_WORKER_ENABLED) return { stop: () => undefined };

  const service = new ReminderWorkerService(prisma, new DiscordBotClient(), logger);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await service.runDueReminders();
      if (result.candidates > 0) logger.info(result, "Notification reminders processed");
    } catch (error) {
      logger.error({ err: error }, "Notification worker failed");
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), env.NOTIFICATION_WORKER_INTERVAL_MS);
  void tick();

  return {
    stop: () => clearInterval(interval),
  };
}
