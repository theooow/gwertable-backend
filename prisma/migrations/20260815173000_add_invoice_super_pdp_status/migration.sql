ALTER TABLE "Invoice" ADD COLUMN "superPdpInvoiceId" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "superPdpStatus" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "superPdpError" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "superPdpSentAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Invoice_superPdpInvoiceId_key" ON "Invoice"("superPdpInvoiceId");
