CREATE TABLE "TaskLabel" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskLabel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskAttachment" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TaskLabel" ("id", "eventId", "name", "color", "updatedAt")
SELECT
  'tasklabel_' || md5(t."eventId" || ':' || tag),
  t."eventId",
  tag,
  CASE (abs(hashtext(tag)) % 8)
    WHEN 0 THEN '#2563eb'
    WHEN 1 THEN '#16a34a'
    WHEN 2 THEN '#dc2626'
    WHEN 3 THEN '#9333ea'
    WHEN 4 THEN '#ea580c'
    WHEN 5 THEN '#0891b2'
    WHEN 6 THEN '#be123c'
    ELSE '#4b5563'
  END,
  CURRENT_TIMESTAMP
FROM "Task" t
CROSS JOIN LATERAL unnest(t."tags") AS tag
WHERE tag <> ''
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "TaskLabel_eventId_name_key" ON "TaskLabel"("eventId", "name");
CREATE INDEX "TaskLabel_eventId_idx" ON "TaskLabel"("eventId");
CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment"("taskId");

ALTER TABLE "TaskLabel"
ADD CONSTRAINT "TaskLabel_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskAttachment"
ADD CONSTRAINT "TaskAttachment_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
