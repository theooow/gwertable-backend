-- DropForeignKey
ALTER TABLE "EquipmentUsage" DROP CONSTRAINT "EquipmentUsage_itemId_fkey";

-- AlterTable
ALTER TABLE "EquipmentItem" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "rentalCoef" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "unitPriceCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "EquipmentUsage" ADD COLUMN     "category" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "rentalCoef" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "itemId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "EquipmentUsage_itemId_idx" ON "EquipmentUsage"("itemId");

-- AddForeignKey
ALTER TABLE "EquipmentUsage" ADD CONSTRAINT "EquipmentUsage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "EquipmentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
