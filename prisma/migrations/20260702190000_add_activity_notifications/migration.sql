CREATE TABLE "ActivityEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT,
    "userId" TEXT NOT NULL,
    "activityId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivityNotificationPreference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskCommentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "budgetChangesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskDueSoonEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskDueSoonMinutes" INTEGER NOT NULL DEFAULT 1440,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityEntry_workspaceId_createdAt_idx" ON "ActivityEntry"("workspaceId", "createdAt");
CREATE INDEX "ActivityEntry_eventId_createdAt_idx" ON "ActivityEntry"("eventId", "createdAt");
CREATE INDEX "ActivityEntry_actorId_createdAt_idx" ON "ActivityEntry"("actorId", "createdAt");
CREATE INDEX "ActivityEntry_type_idx" ON "ActivityEntry"("type");

CREATE INDEX "InAppNotification_workspaceId_userId_createdAt_idx" ON "InAppNotification"("workspaceId", "userId", "createdAt");
CREATE INDEX "InAppNotification_userId_readAt_idx" ON "InAppNotification"("userId", "readAt");
CREATE INDEX "InAppNotification_eventId_createdAt_idx" ON "InAppNotification"("eventId", "createdAt");
CREATE INDEX "InAppNotification_activityId_idx" ON "InAppNotification"("activityId");

CREATE UNIQUE INDEX "ActivityNotificationPreference_workspaceId_userId_key" ON "ActivityNotificationPreference"("workspaceId", "userId");
CREATE INDEX "ActivityNotificationPreference_userId_idx" ON "ActivityNotificationPreference"("userId");

ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ActivityEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityNotificationPreference" ADD CONSTRAINT "ActivityNotificationPreference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityNotificationPreference" ADD CONSTRAINT "ActivityNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
