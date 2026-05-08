-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "avgBasketCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kegUnitPriceCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ConsumableItem" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "estimatedQty" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ConsumableItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsumableItem_eventId_idx" ON "ConsumableItem"("eventId");

-- AddForeignKey
ALTER TABLE "ConsumableItem" ADD CONSTRAINT "ConsumableItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
