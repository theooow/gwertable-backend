-- Free-text questions let organisers collect any personal data; only closed
-- questions remain. Keep answers to the remaining closed questions only, which
-- also drops orphan answers of questions removed earlier.
UPDATE "VolunteerApplication" a SET "answers" = COALESCE((
  SELECT jsonb_agg(ans)
  FROM jsonb_array_elements(a."answers") ans
  WHERE EXISTS (
    SELECT 1
    FROM "VolunteerForm" f, jsonb_array_elements(f."questions") q
    WHERE f."eventId" = a."eventId" AND q->>'type' <> 'text' AND q->>'id' = ans->>'id'
  )
), '[]'::jsonb)
WHERE jsonb_typeof(a."answers") = 'array';

UPDATE "VolunteerForm" SET "questions" = COALESCE((
  SELECT jsonb_agg(q) FROM jsonb_array_elements("questions") q WHERE q->>'type' <> 'text'
), '[]'::jsonb)
WHERE jsonb_typeof("questions") = 'array';
