-- Preserve the issuing organization when its billing settings later change.
ALTER TABLE "Invoice" ADD COLUMN "issuerSnapshot" JSONB;
