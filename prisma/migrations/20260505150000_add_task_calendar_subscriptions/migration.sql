CREATE TABLE "TaskCalendarSubscription" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCalendarSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskCalendarSubscription_eventId_key" ON "TaskCalendarSubscription"("eventId");
CREATE UNIQUE INDEX "TaskCalendarSubscription_token_key" ON "TaskCalendarSubscription"("token");
CREATE INDEX "TaskCalendarSubscription_token_idx" ON "TaskCalendarSubscription"("token");

ALTER TABLE "TaskCalendarSubscription" ADD CONSTRAINT "TaskCalendarSubscription_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
