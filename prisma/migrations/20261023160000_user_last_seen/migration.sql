-- Existing users start their inactivity period at deployment.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "inactivityWarnedAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
