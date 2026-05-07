ALTER TABLE "Expense" ADD COLUMN "sourceParticipantId" TEXT;

CREATE UNIQUE INDEX "Expense_sourceParticipantId_key" ON "Expense"("sourceParticipantId");

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_sourceParticipantId_fkey" FOREIGN KEY ("sourceParticipantId") REFERENCES "EventParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
