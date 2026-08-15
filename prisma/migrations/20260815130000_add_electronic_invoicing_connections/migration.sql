CREATE TYPE "ElectronicInvoicingProvider" AS ENUM ('SUPER_PDP');
CREATE TYPE "ElectronicInvoicingConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');

CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "siren" TEXT,
    "siret" TEXT,
    "vatNumber" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'FR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ElectronicInvoicingConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "ElectronicInvoicingProvider" NOT NULL,
    "status" "ElectronicInvoicingConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "providerOrgId" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ElectronicInvoicingConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ElectronicInvoicingOAuthState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ElectronicInvoicingProvider" NOT NULL,
    "state" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ElectronicInvoicingOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalEntity_workspaceId_key" ON "LegalEntity"("workspaceId");
CREATE INDEX "LegalEntity_siren_idx" ON "LegalEntity"("siren");
CREATE INDEX "LegalEntity_siret_idx" ON "LegalEntity"("siret");
CREATE UNIQUE INDEX "ElectronicInvoicingConnection_workspaceId_provider_key" ON "ElectronicInvoicingConnection"("workspaceId", "provider");
CREATE UNIQUE INDEX "ElectronicInvoicingOAuthState_state_key" ON "ElectronicInvoicingOAuthState"("state");
CREATE INDEX "ElectronicInvoicingOAuthState_workspaceId_provider_idx" ON "ElectronicInvoicingOAuthState"("workspaceId", "provider");
CREATE INDEX "ElectronicInvoicingOAuthState_userId_idx" ON "ElectronicInvoicingOAuthState"("userId");

ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ElectronicInvoicingConnection" ADD CONSTRAINT "ElectronicInvoicingConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ElectronicInvoicingOAuthState" ADD CONSTRAINT "ElectronicInvoicingOAuthState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ElectronicInvoicingOAuthState" ADD CONSTRAINT "ElectronicInvoicingOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
