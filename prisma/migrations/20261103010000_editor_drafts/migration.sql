CREATE TABLE "EditorDraft" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EditorDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EditorDraft_kind_updatedAt_idx" ON "EditorDraft"("kind", "updatedAt" DESC);
