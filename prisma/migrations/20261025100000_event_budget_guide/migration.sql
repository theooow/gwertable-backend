-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "budgetGuideHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "budgetGuideSettingsChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "budgetGuideSkippedSteps" TEXT[] DEFAULT ARRAY[]::TEXT[];
