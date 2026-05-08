-- Add Shotgun integration fields
ALTER TABLE "Workspace" ADD COLUMN "shotgunOrganizerId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "shotgunApiToken" TEXT;

ALTER TABLE "Event" ADD COLUMN "shotgunEventId" INTEGER;
CREATE UNIQUE INDEX "Event_shotgunEventId_key" ON "Event"("shotgunEventId");

ALTER TABLE "TicketTier" ADD COLUMN "shotgunDealId" INTEGER;
CREATE UNIQUE INDEX "TicketTier_shotgunDealId_key" ON "TicketTier"("shotgunDealId");

ALTER TYPE "TicketSource" ADD VALUE IF NOT EXISTS 'API_SHOTGUN';
