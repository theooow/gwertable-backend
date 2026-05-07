ALTER TABLE "RunOfShowItem" ADD COLUMN "responsiblePersonId" TEXT;
ALTER TABLE "RunOfShowItem" ADD COLUMN "sourceTaskId" TEXT;

CREATE UNIQUE INDEX "RunOfShowItem_sourceTaskId_key" ON "RunOfShowItem"("sourceTaskId");
CREATE INDEX "RunOfShowItem_responsiblePersonId_idx" ON "RunOfShowItem"("responsiblePersonId");

ALTER TABLE "RunOfShowItem" ADD CONSTRAINT "RunOfShowItem_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RunOfShowItem" ADD CONSTRAINT "RunOfShowItem_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
