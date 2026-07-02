ALTER TABLE "TaskLabel" RENAME TO "TaskCategory";

ALTER TABLE "TaskCategory" RENAME CONSTRAINT "TaskLabel_pkey" TO "TaskCategory_pkey";
ALTER TABLE "TaskCategory" RENAME CONSTRAINT "TaskLabel_eventId_fkey" TO "TaskCategory_eventId_fkey";

ALTER INDEX "TaskLabel_eventId_name_key" RENAME TO "TaskCategory_eventId_name_key";
ALTER INDEX "TaskLabel_eventId_idx" RENAME TO "TaskCategory_eventId_idx";
