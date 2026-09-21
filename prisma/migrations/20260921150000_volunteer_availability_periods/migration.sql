ALTER TABLE "VolunteerForm" ADD COLUMN "availabilityPeriods" JSONB NOT NULL DEFAULT '[]';
-- Keep existing forms usable with a single fixed event period.
UPDATE "VolunteerForm" f SET "availabilityPeriods" = jsonb_build_array(jsonb_build_object(
  'id', 'event', 'label', 'événement',
  'startsAt', to_char(e."startsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'endsAt', to_char(e."endsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)) FROM "Event" e WHERE e.id = f."eventId" AND e."endsAt" > e."startsAt";
UPDATE "VolunteerForm" SET published = false WHERE "availabilityPeriods" = '[]'::jsonb;
