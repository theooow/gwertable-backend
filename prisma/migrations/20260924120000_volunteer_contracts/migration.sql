CREATE TABLE "VolunteerContract" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "eventId" TEXT NOT NULL REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "personId" TEXT NOT NULL REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "applicationId" TEXT NOT NULL REFERENCES "VolunteerApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" TEXT NOT NULL, "eventName" TEXT NOT NULL, "signerName" TEXT NOT NULL,
  "signerEmail" TEXT NOT NULL, "content" TEXT NOT NULL, "documentHash" TEXT NOT NULL,
  "sourcePdf" BYTEA NOT NULL, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'SIGNED', 'CANCELLED')),
  "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "invitationSentAt" TIMESTAMP(3), "codeHash" TEXT, "codeExpiresAt" TIMESTAMP(3), "codeSentAt" TIMESTAMP(3),
  "codeAttempts" INTEGER NOT NULL DEFAULT 0, "codeSends" INTEGER NOT NULL DEFAULT 0,
  "signedAt" TIMESTAMP(3), "evidence" JSONB, "signedPdf" BYTEA, "signedPdfHash" TEXT
);
CREATE UNIQUE INDEX "VolunteerContract_tokenHash_key" ON "VolunteerContract"("tokenHash");
CREATE INDEX "VolunteerContract_workspaceId_personId_idx" ON "VolunteerContract"("workspaceId", "personId");
CREATE INDEX "VolunteerContract_workspaceId_eventId_idx" ON "VolunteerContract"("workspaceId", "eventId");

-- Source documents are immutable, including while signature is pending.
-- Signed/cancelled records cannot be rewritten through the application DB role.
CREATE FUNCTION protect_volunteer_contract() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PENDING' OR
    (to_jsonb(NEW) - ARRAY['status','tokenHash','expiresAt','invitationSentAt','codeHash','codeExpiresAt','codeSentAt','codeAttempts','codeSends','signedAt','evidence','signedPdf','signedPdfHash'])
      IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','tokenHash','expiresAt','invitationSentAt','codeHash','codeExpiresAt','codeSentAt','codeAttempts','codeSends','signedAt','evidence','signedPdf','signedPdfHash']) THEN
    RAISE EXCEPTION 'Volunteer contract is immutable';
  END IF;
  IF NEW."status" = 'SIGNED' AND (NEW."signedAt" IS NULL OR NEW."evidence" IS NULL OR NEW."signedPdf" IS NULL OR NEW."signedPdfHash" IS NULL) THEN
    RAISE EXCEPTION 'Signature evidence is required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "VolunteerContract_immutable" BEFORE UPDATE ON "VolunteerContract"
FOR EACH ROW EXECUTE FUNCTION protect_volunteer_contract();
