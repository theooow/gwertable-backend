CREATE TABLE "EventNotificationSettings" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "discordChannelId" TEXT,
    "taskReminderOffsetsMinutes" INTEGER[] NOT NULL DEFAULT ARRAY[1440, 60]::INTEGER[],
    "runOfShowReminderOffsetsMinutes" INTEGER[] NOT NULL DEFAULT ARRAY[30]::INTEGER[],
    "overdueEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventNotificationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "offsetMinutes" INTEGER,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventNotificationSettings_eventId_key" ON "EventNotificationSettings"("eventId");
CREATE INDEX "EventNotificationSettings_enabled_idx" ON "EventNotificationSettings"("enabled");

CREATE UNIQUE INDEX "NotificationDelivery_targetType_targetId_reminderType_offsetMinutes_scheduledFor_key"
ON "NotificationDelivery"("targetType", "targetId", "reminderType", "offsetMinutes", "scheduledFor");
CREATE INDEX "NotificationDelivery_eventId_idx" ON "NotificationDelivery"("eventId");
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");
CREATE INDEX "NotificationDelivery_scheduledFor_idx" ON "NotificationDelivery"("scheduledFor");

ALTER TABLE "EventNotificationSettings"
ADD CONSTRAINT "EventNotificationSettings_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
ADD CONSTRAINT "NotificationDelivery_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
