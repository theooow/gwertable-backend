-- CreateTable
CREATE TABLE "RunOfShowTrack" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunOfShowTrack_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "RunOfShowItem" ADD COLUMN "trackId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RunOfShowTrack_eventId_name_key" ON "RunOfShowTrack"("eventId", "name");

-- CreateIndex
CREATE INDEX "RunOfShowTrack_eventId_position_idx" ON "RunOfShowTrack"("eventId", "position");

-- CreateIndex
CREATE INDEX "RunOfShowItem_trackId_idx" ON "RunOfShowItem"("trackId");

-- AddForeignKey
ALTER TABLE "RunOfShowTrack" ADD CONSTRAINT "RunOfShowTrack_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunOfShowItem" ADD CONSTRAINT "RunOfShowItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "RunOfShowTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
