CREATE TABLE "EquipmentImportMatchMemory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "itemId" TEXT,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentImportMatchMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentImportMatchMemory_workspaceId_kind_sourceKey_key" ON "EquipmentImportMatchMemory"("workspaceId", "kind", "sourceKey");
CREATE INDEX "EquipmentImportMatchMemory_workspaceId_kind_idx" ON "EquipmentImportMatchMemory"("workspaceId", "kind");
CREATE INDEX "EquipmentImportMatchMemory_itemId_idx" ON "EquipmentImportMatchMemory"("itemId");
CREATE INDEX "EquipmentImportMatchMemory_supplierId_idx" ON "EquipmentImportMatchMemory"("supplierId");

ALTER TABLE "EquipmentImportMatchMemory"
ADD CONSTRAINT "EquipmentImportMatchMemory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EquipmentImportMatchMemory"
ADD CONSTRAINT "EquipmentImportMatchMemory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "EquipmentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EquipmentImportMatchMemory"
ADD CONSTRAINT "EquipmentImportMatchMemory_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
