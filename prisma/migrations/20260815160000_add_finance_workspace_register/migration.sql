CREATE TYPE "InvoiceDirection" AS ENUM ('OUTGOING', 'INCOMING');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'RECEIVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
CREATE TYPE "ExpenseClaimStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED');

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "eventId" TEXT,
  "direction" "InvoiceDirection" NOT NULL, "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "number" TEXT, "counterpartName" TEXT NOT NULL, "counterpartEmail" TEXT, "counterpartSiren" TEXT,
  "issuedAt" TIMESTAMP(3), "dueAt" TIMESTAMP(3), "paidAt" TIMESTAMP(3), "currency" TEXT NOT NULL DEFAULT 'EUR',
  "totalHtCents" INTEGER NOT NULL DEFAULT 0, "totalVatCents" INTEGER NOT NULL DEFAULT 0, "totalTtcCents" INTEGER NOT NULL DEFAULT 0,
  "documentUrl" TEXT, "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InvoiceLine" (
  "id" TEXT NOT NULL, "invoiceId" TEXT NOT NULL, "label" TEXT NOT NULL, "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
  "unitPriceHtCents" INTEGER NOT NULL, "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
  "totalHtCents" INTEGER NOT NULL, "totalVatCents" INTEGER NOT NULL, "totalTtcCents" INTEGER NOT NULL, "position" INTEGER NOT NULL,
  CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ExpenseClaim" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "eventId" TEXT, "submitterId" TEXT NOT NULL,
  "label" TEXT NOT NULL, "category" TEXT NOT NULL DEFAULT 'autre', "amountHtCents" INTEGER NOT NULL,
  "amountVatCents" INTEGER NOT NULL, "amountTtcCents" INTEGER NOT NULL, "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
  "purchasedAt" TIMESTAMP(3), "receiptUrl" TEXT, "notes" TEXT, "status" "ExpenseClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reviewerNote" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpenseClaim_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Expense" ADD COLUMN "expenseClaimId" TEXT;
CREATE UNIQUE INDEX "Expense_expenseClaimId_key" ON "Expense"("expenseClaimId");
CREATE UNIQUE INDEX "Invoice_workspaceId_number_key" ON "Invoice"("workspaceId", "number");
CREATE INDEX "Invoice_workspaceId_direction_status_idx" ON "Invoice"("workspaceId", "direction", "status");
CREATE INDEX "Invoice_eventId_idx" ON "Invoice"("eventId");
CREATE INDEX "InvoiceLine_invoiceId_position_idx" ON "InvoiceLine"("invoiceId", "position");
CREATE INDEX "ExpenseClaim_workspaceId_status_idx" ON "ExpenseClaim"("workspaceId", "status");
CREATE INDEX "ExpenseClaim_eventId_idx" ON "ExpenseClaim"("eventId");
CREATE INDEX "ExpenseClaim_submitterId_idx" ON "ExpenseClaim"("submitterId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_expenseClaimId_fkey" FOREIGN KEY ("expenseClaimId") REFERENCES "ExpenseClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
