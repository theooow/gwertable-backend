-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "anonymousId" TEXT,
    "userId" TEXT,
    "workspaceId" TEXT,
    "eventId" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackingEvent_name_createdAt_idx" ON "TrackingEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingEvent_userId_createdAt_idx" ON "TrackingEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingEvent_anonymousId_idx" ON "TrackingEvent"("anonymousId");
