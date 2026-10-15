ALTER TABLE "MaterialBatchEntry" ADD COLUMN "distributorId" TEXT;

UPDATE "MaterialBatchEntry" AS entry
SET "distributorId" = batch."distributorId"
FROM "MaterialBatch" AS batch
WHERE entry."batchId" = batch."id";

ALTER TABLE "MaterialBatchEntry" ALTER COLUMN "distributorId" SET NOT NULL;
CREATE INDEX "MaterialBatchEntry_distributorId_idx" ON "MaterialBatchEntry"("distributorId");
ALTER TABLE "MaterialBatchEntry" ADD CONSTRAINT "MaterialBatchEntry_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialBatch" DROP CONSTRAINT "MaterialBatch_distributorId_fkey";
DROP INDEX "MaterialBatch_distributorId_idx";
ALTER TABLE "MaterialBatch" DROP COLUMN "distributorId";

CREATE TABLE "MaterialBatchAttachment" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialBatchAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialBatchAttachment_objectKey_key" ON "MaterialBatchAttachment"("objectKey");
CREATE UNIQUE INDEX "MaterialBatchAttachment_batchId_position_key" ON "MaterialBatchAttachment"("batchId", "position");
ALTER TABLE "MaterialBatchAttachment" ADD CONSTRAINT "MaterialBatchAttachment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
