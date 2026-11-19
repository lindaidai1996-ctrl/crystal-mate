-- Additive migration: preserve every legacy membership and its independent notes.
CREATE TABLE "SharedAttachment" (
 "id" TEXT PRIMARY KEY, "objectKey" TEXT NOT NULL, "url" TEXT NOT NULL,
 "fileName" TEXT NOT NULL, "notes" TEXT NOT NULL DEFAULT '',
 "version" INTEGER NOT NULL DEFAULT 1, "imageVersion" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SharedAttachment_objectKey_idx" ON "SharedAttachment"("objectKey");
ALTER TABLE "Distributor" ADD COLUMN "attachmentsVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MaterialBatch" ADD COLUMN "attachmentsVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DistributorAttachment" ADD COLUMN "assetId" TEXT;
ALTER TABLE "MaterialBatchAttachment" ADD COLUMN "assetId" TEXT;
INSERT INTO "SharedAttachment" ("id","objectKey","url","fileName","notes","createdAt")
 SELECT 'distributor-' || "id","objectKey","url","fileName","notes","createdAt" FROM "DistributorAttachment";
INSERT INTO "SharedAttachment" ("id","objectKey","url","fileName","notes","createdAt")
 SELECT 'batch-' || "id","objectKey","url","fileName","notes","createdAt" FROM "MaterialBatchAttachment";
UPDATE "DistributorAttachment" SET "assetId" = 'distributor-' || "id";
UPDATE "MaterialBatchAttachment" SET "assetId" = 'batch-' || "id";
ALTER TABLE "DistributorAttachment" ALTER COLUMN "assetId" SET NOT NULL;
ALTER TABLE "MaterialBatchAttachment" ALTER COLUMN "assetId" SET NOT NULL;
ALTER TABLE "DistributorAttachment" ADD CONSTRAINT "DistributorAttachment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "SharedAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaterialBatchAttachment" ADD CONSTRAINT "MaterialBatchAttachment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "SharedAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "DistributorAttachment_distributorId_assetId_key" ON "DistributorAttachment"("distributorId","assetId");
CREATE UNIQUE INDEX "MaterialBatchAttachment_batchId_assetId_key" ON "MaterialBatchAttachment"("batchId","assetId");
CREATE TABLE "AttachmentRecognition" (
 "id" TEXT PRIMARY KEY,"assetId" TEXT NOT NULL,"ownerId" TEXT NOT NULL,
 "imageVersion" INTEGER NOT NULL,"promptVersion" TEXT NOT NULL,"provider" TEXT NOT NULL,"model" TEXT NOT NULL,
 "status" TEXT NOT NULL,"result" JSONB,"usage" JSONB,"errorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AttachmentRecognition_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "SharedAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AttachmentRecognition_assetId_imageVersion_createdAt_idx" ON "AttachmentRecognition"("assetId","imageVersion","createdAt");
