-- AlterTable
ALTER TABLE "EquipmentItem"
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "photoUrl"   TEXT,
  ADD COLUMN "color"      TEXT;

-- AddForeignKey
ALTER TABLE "EquipmentItem" ADD CONSTRAINT "EquipmentItem_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
