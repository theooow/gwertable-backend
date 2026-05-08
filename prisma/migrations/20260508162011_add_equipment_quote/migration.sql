-- AlterTable
ALTER TABLE "EquipmentUsage" ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "equipmentQuoteId" TEXT;

-- CreateTable
CREATE TABLE "EquipmentQuote" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "discountCents" INTEGER,
    "discountPct" DECIMAL(5,2),
    "fileUrl" TEXT,

    CONSTRAINT "EquipmentQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentQuote_eventId_idx" ON "EquipmentQuote"("eventId");

-- CreateIndex
CREATE INDEX "EquipmentUsage_quoteId_idx" ON "EquipmentUsage"("quoteId");

-- AddForeignKey
ALTER TABLE "EquipmentQuote" ADD CONSTRAINT "EquipmentQuote_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsage" ADD CONSTRAINT "EquipmentUsage_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "EquipmentQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
