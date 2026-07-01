ALTER TABLE "EventNotificationSettings"
ADD COLUMN "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "NotificationDelivery"
ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'DISCORD';

DROP INDEX "NotificationDelivery_targetType_targetId_reminderType_offsetMinutes_scheduledFor_key";

CREATE UNIQUE INDEX "NotificationDelivery_targetType_targetId_channel_reminderType_offsetMinutes_scheduledFor_key"
ON "NotificationDelivery"("targetType", "targetId", "channel", "reminderType", "offsetMinutes", "scheduledFor");
