INSERT INTO "TaskLabel" ("id", "eventId", "name", "color", "updatedAt")
SELECT
  'tasklabel_default_' || md5(e."id" || ':' || defaults."name"),
  e."id",
  defaults."name",
  defaults."color",
  CURRENT_TIMESTAMP
FROM "Event" e
CROSS JOIN (
  VALUES
    ('logistique', '#2563eb'),
    ('communication', '#16a34a'),
    ('technique', '#dc2626'),
    ('artistique', '#9333ea'),
    ('administratif', '#ea580c'),
    ('courses', '#0891b2'),
    ('autre', '#4b5563')
) AS defaults("name", "color")
ON CONFLICT ("eventId", "name") DO NOTHING;
