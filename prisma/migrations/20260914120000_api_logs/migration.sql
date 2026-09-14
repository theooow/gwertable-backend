CREATE TABLE "ApiLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "userId" TEXT,
  "userEmail" TEXT,
  "workspaceId" TEXT,
  "action" TEXT,
  "requestBody" JSONB NOT NULL,
  "responseBody" JSONB NOT NULL,
  "query" JSONB NOT NULL
);
CREATE INDEX "ApiLog_createdAt_id_idx" ON "ApiLog"("createdAt", "id");
CREATE INDEX "ApiLog_userId_createdAt_idx" ON "ApiLog"("userId", "createdAt");
CREATE INDEX "ApiLog_statusCode_createdAt_idx" ON "ApiLog"("statusCode", "createdAt");
CREATE INDEX "ApiLog_action_createdAt_idx" ON "ApiLog"("action", "createdAt");
