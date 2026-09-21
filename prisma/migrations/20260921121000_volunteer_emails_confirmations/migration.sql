ALTER TABLE "Shift" ADD COLUMN "confirmationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "confirmationVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "VolunteerEmail" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "applicationId" TEXT NOT NULL REFERENCES "VolunteerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL UNIQUE,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "VolunteerEmail_sentAt_availableAt_idx" ON "VolunteerEmail"("sentAt", "availableAt");
