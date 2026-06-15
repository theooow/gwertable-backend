-- CreateEnum
CREATE TYPE "BudgetPhase" AS ENUM ('FORECAST', 'ACTUAL');

-- CreateEnum
CREATE TYPE "AmountInputMode" AS ENUM ('HT', 'TTC');

-- CreateEnum
CREATE TYPE "VatMode" AS ENUM ('NON_ASSUJETTI', 'ASSUJETTI');

-- CreateEnum
CREATE TYPE "SacemBase" AS ENUM ('TICKETING', 'TOTAL_REVENUE');

-- AlterTable
ALTER TABLE "Event"
ADD COLUMN "defaultVatRateBasisPoints" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN "sacemBase" "SacemBase" NOT NULL DEFAULT 'TICKETING',
ADD COLUMN "sacemRateBasisPoints" INTEGER NOT NULL DEFAULT 1150,
ADD COLUMN "vatMode" "VatMode" NOT NULL DEFAULT 'NON_ASSUJETTI';

-- AlterTable
ALTER TABLE "Expense"
ADD COLUMN "amountHtCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "amountInputMode" "AmountInputMode" NOT NULL DEFAULT 'TTC',
ADD COLUMN "amountTtcCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "amountVatCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "phase" "BudgetPhase" NOT NULL DEFAULT 'ACTUAL',
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Income"
ADD COLUMN "amountHtCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "amountInputMode" "AmountInputMode" NOT NULL DEFAULT 'TTC',
ADD COLUMN "amountTtcCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "amountVatCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "phase" "BudgetPhase" NOT NULL DEFAULT 'ACTUAL',
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 0;

UPDATE "Expense"
SET
  "amountTtcCents" = "amountCents",
  "amountHtCents" = "amountCents",
  "amountVatCents" = 0;

UPDATE "Income"
SET
  "amountTtcCents" = "amountCents",
  "amountHtCents" = "amountCents",
  "amountVatCents" = 0;
