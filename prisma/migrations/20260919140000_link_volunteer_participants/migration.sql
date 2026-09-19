-- Internal registrations also support contacts without email or public consent.
ALTER TABLE "VolunteerApplication" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "VolunteerApplication" ALTER COLUMN "consentAt" DROP NOT NULL;

-- Preserve existing volunteers and assignments; availability must be confirmed by an organizer.
INSERT INTO "VolunteerApplication" (
  "id", "eventId", "personId", "email", "fullName", "phone", "status",
  "dietary", "consentAt", "reviewedAt", "createdAt", "updatedAt"
)
SELECT 'participant_' || ep."id", ep."eventId", ep."personId", NULL,
  p."fullName", COALESCE(p."phone", ''), 'APPROVED', COALESCE(ep."dietary", ''),
  NULL, CURRENT_TIMESTAMP, ep."createdAt", CURRENT_TIMESTAMP
FROM "EventParticipant" ep
JOIN "Person" p ON p."id" = ep."personId"
WHERE 'VOLUNTEER' = ANY(ep."roles")
ON CONFLICT ("eventId", "personId") DO NOTHING;
