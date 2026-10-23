-- Free-text notes about volunteers and participants may hold sensitive or
-- subjective personal data: drop them and their content.
-- AlterTable
ALTER TABLE "VolunteerApplication" DROP COLUMN "notes",
DROP COLUMN "internalNotes";

-- AlterTable
ALTER TABLE "EventParticipant" DROP COLUMN "internalNotes";
