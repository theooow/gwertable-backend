-- DropForeignKey
ALTER TABLE "ElectronicInvoicingConnection" DROP CONSTRAINT "ElectronicInvoicingConnection_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ElectronicInvoicingOAuthState" DROP CONSTRAINT "ElectronicInvoicingOAuthState_userId_fkey";

-- DropForeignKey
ALTER TABLE "ElectronicInvoicingOAuthState" DROP CONSTRAINT "ElectronicInvoicingOAuthState_workspaceId_fkey";

-- DropIndex
DROP INDEX "Invoice_superPdpInvoiceId_key";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "superPdpError",
DROP COLUMN "superPdpInvoiceId",
DROP COLUMN "superPdpSentAt",
DROP COLUMN "superPdpStatus";

-- DropTable
DROP TABLE "ElectronicInvoicingConnection";

-- DropTable
DROP TABLE "ElectronicInvoicingOAuthState";

-- DropEnum
DROP TYPE "ElectronicInvoicingConnectionStatus";

-- DropEnum
DROP TYPE "ElectronicInvoicingProvider";
