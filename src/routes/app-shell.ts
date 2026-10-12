import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { activityQuerySchema } from "../schemas/activity.js";
import { WorkspaceDao } from "../dao/workspace.dao.js";
import { WorkspaceMemberDao } from "../dao/workspace-member.dao.js";
import { WorkspaceInvitationDao } from "../dao/workspace-invitation.dao.js";
import { EventCollaboratorDao } from "../dao/event-collaborator.dao.js";
import { WorkspaceRepository } from "../repositories/workspace.repository.js";
import { WorkspaceService } from "../services/workspace.service.js";
import { ActivityRepository } from "../repositories/activity.repository.js";
import { ActivityService } from "../services/activity.service.js";
import { viewerOf } from "./activity.js";
import { listVisibleEvents } from "./events.js";

const workspaceService = new WorkspaceService(
  new WorkspaceRepository(
    new WorkspaceDao(prisma),
    new WorkspaceMemberDao(prisma),
    new WorkspaceInvitationDao(prisma),
    new EventCollaboratorDao(prisma),
    prisma,
  ),
);
const activityService = new ActivityService(new ActivityRepository(prisma));
// The app frame only shows the unread badge; the drawer loads the full feed when opened.
const shellActivityQuery = activityQuerySchema.parse({ limit: 1 });

export async function appShellRoutes(fastify: FastifyInstance) {
  fastify.get("/api/app-shell", { config: { documentation: {  } } }, async (request) => {
    const [workspaces, invitedEvents, activity, events] = await Promise.all([
      workspaceService.listWorkspaces(request.user!.id, request.user!.email, request.workspaceId),
      workspaceService.listInvitedEvents(request.userRole, request.user!.id, request.user!.email),
      activityService.list(request.workspaceId, viewerOf(request), shellActivityQuery),
      listVisibleEvents(request),
    ]);
    return { workspaces, invitedEvents, activity, events };
  });
}
