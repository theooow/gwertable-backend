-- CreateEnum
CREATE TYPE "VolunteerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "team" TEXT;

-- CreateTable
CREATE TABLE "VolunteerForm" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT 'Devenir bénévole',
    "description" TEXT NOT NULL DEFAULT '',
    "confirmationMessage" TEXT NOT NULL DEFAULT 'Votre candidature a été reçue. L’organisation doit encore la valider.',
    "closesAt" TIMESTAMP(3),
    "collectPhone" BOOLEAN NOT NULL DEFAULT true,
    "collectDietary" BOOLEAN NOT NULL DEFAULT true,
    "teams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "questions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerApplication" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "status" "VolunteerStatus" NOT NULL DEFAULT 'PENDING',
    "preferredTeams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "team" TEXT NOT NULL DEFAULT '',
    "availability" JSONB NOT NULL DEFAULT '[]',
    "dietary" TEXT NOT NULL DEFAULT '',
    "answers" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "internalNotes" TEXT NOT NULL DEFAULT '',
    "consentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CateringService" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,

    CONSTRAINT "CateringService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CateringBooking" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "servedAt" TIMESTAMP(3),

    CONSTRAINT "CateringBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerForm_eventId_key" ON "VolunteerForm"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerForm_token_key" ON "VolunteerForm"("token");

-- CreateIndex
CREATE INDEX "VolunteerApplication_eventId_status_idx" ON "VolunteerApplication"("eventId", "status");

-- CreateIndex
CREATE INDEX "VolunteerApplication_personId_idx" ON "VolunteerApplication"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerApplication_eventId_email_key" ON "VolunteerApplication"("eventId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerApplication_eventId_personId_key" ON "VolunteerApplication"("eventId", "personId");

-- CreateIndex
CREATE INDEX "CateringService_eventId_startsAt_idx" ON "CateringService"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "CateringBooking_applicationId_idx" ON "CateringBooking"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "CateringBooking_serviceId_applicationId_key" ON "CateringBooking"("serviceId", "applicationId");

-- AddForeignKey
ALTER TABLE "VolunteerForm" ADD CONSTRAINT "VolunteerForm_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerApplication" ADD CONSTRAINT "VolunteerApplication_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerApplication" ADD CONSTRAINT "VolunteerApplication_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CateringService" ADD CONSTRAINT "CateringService_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CateringBooking" ADD CONSTRAINT "CateringBooking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "CateringService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CateringBooking" ADD CONSTRAINT "CateringBooking_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "VolunteerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
