-- CreateEnum
CREATE TYPE "ProfitSplitMode" AS ENUM ('EQUAL', 'PRO_RATA_INVESTMENT', 'CUSTOM');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "profitSplitMode" "ProfitSplitMode" NOT NULL DEFAULT 'EQUAL';

-- CreateTable
CREATE TABLE "EventCollective" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shareBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCollective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCollectiveMember" (
    "id" TEXT NOT NULL,
    "collectiveId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,

    CONSTRAINT "EventCollectiveMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventCollective_eventId_idx" ON "EventCollective"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventCollectiveMember_participantId_key" ON "EventCollectiveMember"("participantId");

-- CreateIndex
CREATE INDEX "EventCollectiveMember_collectiveId_idx" ON "EventCollectiveMember"("collectiveId");

-- AddForeignKey
ALTER TABLE "EventCollective" ADD CONSTRAINT "EventCollective_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCollectiveMember" ADD CONSTRAINT "EventCollectiveMember_collectiveId_fkey" FOREIGN KEY ("collectiveId") REFERENCES "EventCollective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCollectiveMember" ADD CONSTRAINT "EventCollectiveMember_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "EventParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
