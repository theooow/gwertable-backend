-- AlterTable
ALTER TABLE "ActivityNotificationPreference" ADD COLUMN     "equipmentChangesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "volunteerChangesEnabled" BOOLEAN NOT NULL DEFAULT true;
