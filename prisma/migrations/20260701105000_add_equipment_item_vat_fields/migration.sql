ALTER TABLE "EquipmentItem"
ADD COLUMN "amountInputMode" "AmountInputMode" NOT NULL DEFAULT 'TTC',
ADD COLUMN "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 2000;
