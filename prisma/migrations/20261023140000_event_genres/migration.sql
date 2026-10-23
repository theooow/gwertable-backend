-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "genres" TEXT[] DEFAULT ARRAY[]::TEXT[];
