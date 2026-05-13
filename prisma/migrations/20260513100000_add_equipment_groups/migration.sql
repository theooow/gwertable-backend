-- CreateTable
CREATE TABLE "EquipmentGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentGroupItem" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "EquipmentGroupItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentGroup_workspaceId_idx" ON "EquipmentGroup"("workspaceId");

-- CreateIndex
CREATE INDEX "EquipmentGroupItem_groupId_idx" ON "EquipmentGroupItem"("groupId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "EquipmentGroupItem_groupId_itemId_key" ON "EquipmentGroupItem"("groupId", "itemId");

-- AddForeignKey
ALTER TABLE "EquipmentGroup" ADD CONSTRAINT "EquipmentGroup_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentGroupItem" ADD CONSTRAINT "EquipmentGroupItem_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "EquipmentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentGroupItem" ADD CONSTRAINT "EquipmentGroupItem_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "EquipmentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
