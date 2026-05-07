CREATE TABLE "EventCollaborator" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventCollaborator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventCollaborator_token_key" ON "EventCollaborator"("token");
CREATE INDEX "EventCollaborator_eventId_idx" ON "EventCollaborator"("eventId");
CREATE INDEX "EventCollaborator_workspaceId_idx" ON "EventCollaborator"("workspaceId");
CREATE INDEX "EventCollaborator_email_idx" ON "EventCollaborator"("email");
CREATE INDEX "EventCollaborator_userId_idx" ON "EventCollaborator"("userId");
CREATE UNIQUE INDEX "EventCollaborator_eventId_email_key" ON "EventCollaborator"("eventId", "email");

ALTER TABLE "EventCollaborator" ADD CONSTRAINT "EventCollaborator_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCollaborator" ADD CONSTRAINT "EventCollaborator_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCollaborator" ADD CONSTRAINT "EventCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
