-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('MANUAL');

-- DropIndex
DROP INDEX "Person_discordUserId_key";

-- DropIndex
DROP INDEX "Person_email_key";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "nbCollectifs" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "TicketTier" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizerRevenueCents" INTEGER NOT NULL,
    "publicPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "source" "TicketSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "TicketTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketTier_eventId_idx" ON "TicketTier"("eventId");

-- AddForeignKey
ALTER TABLE "TicketTier" ADD CONSTRAINT "TicketTier_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
