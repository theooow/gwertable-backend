-- CreateEnum
CREATE TYPE "AccountingFramework" AS ENUM ('ASSOCIATION', 'COMPANY');

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "framework" "AccountingFramework" NOT NULL DEFAULT 'ASSOCIATION',
    "openingCashCents" INTEGER NOT NULL DEFAULT 0,
    "closingBankBalanceCents" INTEGER,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedSnapshot" JSONB,
    "closedHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalYear_workspaceId_startsOn_idx" ON "FiscalYear"("workspaceId", "startsOn");

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
