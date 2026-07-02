CREATE TABLE "TaskAssignee" (
  "taskId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId", "personId")
);

INSERT INTO "TaskAssignee" ("taskId", "personId")
SELECT "id", "assigneeId"
FROM "Task"
WHERE "assigneeId" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX "TaskAssignee_personId_idx" ON "TaskAssignee"("personId");

ALTER TABLE "TaskAssignee"
ADD CONSTRAINT "TaskAssignee_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskAssignee"
ADD CONSTRAINT "TaskAssignee_personId_fkey"
FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
