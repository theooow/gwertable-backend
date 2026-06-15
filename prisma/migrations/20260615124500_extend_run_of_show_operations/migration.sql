-- CreateEnum
CREATE TYPE "RunOfShowStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'DELAYED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RunOfShowSection" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunOfShowSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunOfShowDependency" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "RunOfShowDependency_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "RunOfShowItem" ADD COLUMN "actualStartedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "delayReason" TEXT,
ADD COLUMN "sectionId" TEXT,
ADD COLUMN "stakeholderNote" TEXT,
ADD COLUMN "status" "RunOfShowStatus" NOT NULL DEFAULT 'PLANNED';

-- CreateIndex
CREATE UNIQUE INDEX "RunOfShowSection_eventId_name_key" ON "RunOfShowSection"("eventId", "name");

-- CreateIndex
CREATE INDEX "RunOfShowSection_eventId_position_idx" ON "RunOfShowSection"("eventId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RunOfShowDependency_itemId_dependsOnId_key" ON "RunOfShowDependency"("itemId", "dependsOnId");

-- CreateIndex
CREATE INDEX "RunOfShowDependency_dependsOnId_idx" ON "RunOfShowDependency"("dependsOnId");

-- CreateIndex
CREATE INDEX "RunOfShowItem_sectionId_idx" ON "RunOfShowItem"("sectionId");

-- CreateIndex
CREATE INDEX "RunOfShowItem_status_idx" ON "RunOfShowItem"("status");

-- AddForeignKey
ALTER TABLE "RunOfShowSection" ADD CONSTRAINT "RunOfShowSection_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunOfShowItem" ADD CONSTRAINT "RunOfShowItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "RunOfShowSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunOfShowDependency" ADD CONSTRAINT "RunOfShowDependency_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RunOfShowItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunOfShowDependency" ADD CONSTRAINT "RunOfShowDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "RunOfShowItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
