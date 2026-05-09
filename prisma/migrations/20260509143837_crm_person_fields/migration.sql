-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('CONTACT', 'ARTIST', 'SUPPLIER', 'VENUE');

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "availability" TEXT,
ADD COLUMN     "averageFee" INTEGER,
ADD COLUMN     "bookingContact" TEXT,
ADD COLUMN     "contactType" "PersonType" NOT NULL DEFAULT 'CONTACT',
ADD COLUMN     "electricalPower" TEXT,
ADD COLUMN     "musicalStyle" TEXT,
ADD COLUMN     "negotiatedPrices" TEXT,
ADD COLUMN     "openingHours" TEXT,
ADD COLUMN     "riderNotes" TEXT,
ADD COLUMN     "securityContact" TEXT,
ADD COLUMN     "sensibleNeighborhood" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "soundConstraints" TEXT,
ADD COLUMN     "specialConditions" TEXT,
ADD COLUMN     "technicalConstraints" TEXT,
ADD COLUMN     "venueCapacity" INTEGER;

-- CreateTable
CREATE TABLE "PersonDocument" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isUpload" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonHistoryNote" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonHistoryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonDocument_personId_idx" ON "PersonDocument"("personId");

-- CreateIndex
CREATE INDEX "PersonHistoryNote_personId_idx" ON "PersonHistoryNote"("personId");

-- AddForeignKey
ALTER TABLE "PersonDocument" ADD CONSTRAINT "PersonDocument_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonHistoryNote" ADD CONSTRAINT "PersonHistoryNote_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
