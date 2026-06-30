ALTER TABLE "EquipmentQuote"
ADD COLUMN "amountInputMode" "AmountInputMode" NOT NULL DEFAULT 'TTC',
ADD COLUMN "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 2000;

ALTER TABLE "EquipmentUsage"
ADD COLUMN "amountInputMode" "AmountInputMode" NOT NULL DEFAULT 'TTC',
ADD COLUMN "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 2000;
