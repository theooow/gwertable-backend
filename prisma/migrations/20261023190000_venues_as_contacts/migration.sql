-- Venues become address book contacts. Each venue turns into a VENUE contact
-- with the same id, so events keep pointing at it.
INSERT INTO "Person" ("id", "workspaceId", "fullName", "address", "venueCapacity", "specialConditions", "contactType", "tags", "flags", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "workspaceId", "name", "address", "capacity", "notes", 'VENUE', ARRAY[]::TEXT[], ARRAY[]::"ContactFlag"[], "archivedAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Venue";

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_venueId_fkey";

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropTable
DROP TABLE "Venue";
