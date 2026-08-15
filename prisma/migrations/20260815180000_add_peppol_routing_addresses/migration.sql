ALTER TABLE "LegalEntity" ADD COLUMN "peppolEndpoint" TEXT;
ALTER TABLE "LegalEntity" ADD COLUMN "peppolEndpointScheme" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "counterpartPeppolEndpoint" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "counterpartPeppolEndpointScheme" TEXT;
