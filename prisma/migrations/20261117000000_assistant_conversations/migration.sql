-- Only assistant-owned tables. No business data updates, triggers or baseline changes.
CREATE TABLE "AssistantConversation" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB,
  "activeExecutionId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AssistantExecution" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "parentId" TEXT,
  "text" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantExecution_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AssistantMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AssistantConversation_ownerId_updatedAt_idx" ON "AssistantConversation"("ownerId", "updatedAt" DESC);
CREATE UNIQUE INDEX "AssistantExecution_conversationId_generation_key" ON "AssistantExecution"("conversationId", "generation");
CREATE INDEX "AssistantExecution_ownerId_conversationId_createdAt_idx" ON "AssistantExecution"("ownerId", "conversationId", "createdAt");
CREATE INDEX "AssistantMessage_ownerId_conversationId_createdAt_idx" ON "AssistantMessage"("ownerId", "conversationId", "createdAt");
CREATE UNIQUE INDEX "AssistantMessage_executionId_role_key" ON "AssistantMessage"("executionId", "role");
ALTER TABLE "AssistantExecution" ADD CONSTRAINT "AssistantExecution_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
