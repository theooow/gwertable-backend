ALTER TABLE "Shift" ADD COLUMN "swapAllowed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "VolunteerApplication" ADD COLUMN "planningResponse" TEXT,
  ADD COLUMN "planningRespondedAt" TIMESTAMP(3);
