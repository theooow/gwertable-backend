-- CreateTable
CREATE TABLE "BudgetLead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "anonymousId" TEXT,
    "trial" JSONB,
    "trialCompletedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "convertedUserId" TEXT,
    "convertedEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLead_token_key" ON "BudgetLead"("token");

-- CreateIndex
CREATE INDEX "BudgetLead_email_idx" ON "BudgetLead"("email");

-- CreateIndex
CREATE INDEX "BudgetLead_createdAt_idx" ON "BudgetLead"("createdAt");
