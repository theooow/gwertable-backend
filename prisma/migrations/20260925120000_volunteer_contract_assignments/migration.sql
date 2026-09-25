ALTER TABLE "VolunteerForm"
  ADD COLUMN "contractContact" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contractRepresentative" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contractRetentionYears" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "VolunteerContract" ADD COLUMN "assignmentHash" TEXT, ADD COLUMN "snapshot" JSONB;
ALTER TABLE "VolunteerApplication" ADD COLUMN "contractRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "VolunteerContractAccess" (
  "tokenHash" TEXT PRIMARY KEY,
  "contractId" TEXT NOT NULL REFERENCES "VolunteerContract"("id") ON DELETE CASCADE,
  "portalTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "VolunteerContractAccess_contractId_idx" ON "VolunteerContractAccess"("contractId");
