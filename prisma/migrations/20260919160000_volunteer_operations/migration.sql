ALTER TABLE "VolunteerApplication" ADD COLUMN "accessToken" TEXT, ADD COLUMN "badgeToken" TEXT, ADD COLUMN "checkedInAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "VolunteerApplication_accessToken_key" ON "VolunteerApplication"("accessToken");
CREATE UNIQUE INDEX "VolunteerApplication_badgeToken_key" ON "VolunteerApplication"("badgeToken");
CREATE TABLE "VolunteerSwap" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "applicationId" TEXT NOT NULL REFERENCES "VolunteerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceShiftId" TEXT NOT NULL,
  "targetShiftId" TEXT NOT NULL,
  "targetPersonId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "VolunteerSwap_applicationId_status_idx" ON "VolunteerSwap"("applicationId", "status");
CREATE INDEX "VolunteerSwap_targetPersonId_status_idx" ON "VolunteerSwap"("targetPersonId", "status");
