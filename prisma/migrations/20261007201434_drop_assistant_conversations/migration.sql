-- DropForeignKey
ALTER TABLE "AssistantConversation" DROP CONSTRAINT "AssistantConversation_userId_fkey";

-- DropForeignKey
ALTER TABLE "AssistantConversation" DROP CONSTRAINT "AssistantConversation_workspaceId_fkey";

-- DropTable
DROP TABLE "AssistantConversation";
