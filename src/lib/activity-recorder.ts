import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import { prisma } from "../prisma.js";
import { ActivityRepository, type RecordActivityInput } from "../repositories/activity.repository.js";

const activityRepository = new ActivityRepository(prisma);

export type RequestActivityInput = Omit<RecordActivityInput, "workspaceId" | "actorId">;

/** The feed is a side record: failing to write it must never fail the change it describes. */
export async function recordActivity(input: RecordActivityInput, log: FastifyBaseLogger) {
  try {
    await activityRepository.record(input);
  } catch (error) {
    log.warn({ err: error, activityType: input.type }, "Activity entry could not be recorded");
  }
}

export function recordRequestActivity(request: FastifyRequest, input: RequestActivityInput) {
  return recordActivity({ ...input, workspaceId: request.workspaceId, actorId: request.user?.id ?? null }, request.log);
}
