-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- Seed one workspace for existing production data.
INSERT INTO "Workspace" ("id", "name", "createdAt", "updatedAt")
VALUES ('legacy_workspace', 'Abregi', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "defaultWorkspaceId" TEXT;
ALTER TABLE "Person" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Venue" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "EquipmentItem" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Event" ADD COLUMN "workspaceId" TEXT;

-- Backfill existing rows.
UPDATE "User" SET "defaultWorkspaceId" = 'legacy_workspace' WHERE "defaultWorkspaceId" IS NULL;
UPDATE "Person" SET "workspaceId" = 'legacy_workspace' WHERE "workspaceId" IS NULL;
UPDATE "Venue" SET "workspaceId" = 'legacy_workspace' WHERE "workspaceId" IS NULL;
UPDATE "Supplier" SET "workspaceId" = 'legacy_workspace' WHERE "workspaceId" IS NULL;
UPDATE "EquipmentItem" SET "workspaceId" = 'legacy_workspace' WHERE "workspaceId" IS NULL;
UPDATE "Event" SET "workspaceId" = 'legacy_workspace' WHERE "workspaceId" IS NULL;

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'legacy_member_' || "id", 'legacy_workspace', "id", "role", CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT DO NOTHING;

-- Make scoped data required.
ALTER TABLE "Person" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Venue" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "EquipmentItem" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "workspaceId" SET NOT NULL;

-- Drop global contact uniqueness and replace it with per-workspace uniqueness.
ALTER TABLE "Person" DROP CONSTRAINT IF EXISTS "Person_email_key";
ALTER TABLE "Person" DROP CONSTRAINT IF EXISTS "Person_discordUserId_key";

-- CreateIndex
CREATE INDEX "User_defaultWorkspaceId_idx" ON "User"("defaultWorkspaceId");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE INDEX "Person_workspaceId_idx" ON "Person"("workspaceId");
CREATE UNIQUE INDEX "Person_workspaceId_email_key" ON "Person"("workspaceId", "email");
CREATE UNIQUE INDEX "Person_workspaceId_discordUserId_key" ON "Person"("workspaceId", "discordUserId");
CREATE INDEX "Venue_workspaceId_idx" ON "Venue"("workspaceId");
CREATE INDEX "Supplier_workspaceId_idx" ON "Supplier"("workspaceId");
CREATE INDEX "EquipmentItem_workspaceId_idx" ON "EquipmentItem"("workspaceId");
CREATE INDEX "Event_workspaceId_idx" ON "Event"("workspaceId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultWorkspaceId_fkey" FOREIGN KEY ("defaultWorkspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Person" ADD CONSTRAINT "Person_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EquipmentItem" ADD CONSTRAINT "EquipmentItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
