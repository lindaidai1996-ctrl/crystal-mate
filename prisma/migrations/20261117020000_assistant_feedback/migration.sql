BEGIN;
CREATE TABLE "AssistantFeedback" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "questionMessageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" JSONB,
    "note" TEXT NOT NULL DEFAULT '',
    "ruleVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "relevancePromptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantFeedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssistantFeedback_kind_check" CHECK ("kind" IN ('should_include', 'does_not_belong', 'misunderstood')),
    CONSTRAINT "AssistantFeedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssistantFeedback_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AssistantExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssistantFeedback_questionMessageId_fkey" FOREIGN KEY ("questionMessageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AssistantFeedback_ownerId_conversationId_createdAt_idx" ON "AssistantFeedback"("ownerId", "conversationId", "createdAt" DESC);
CREATE INDEX "AssistantFeedback_executionId_idx" ON "AssistantFeedback"("executionId");
COMMIT;
