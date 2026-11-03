ALTER TABLE "Distributor" ADD COLUMN "coverObjectKey" TEXT;
ALTER TABLE "MaterialBatch" ADD COLUMN "coverObjectKey" TEXT;

DROP INDEX "DistributorAttachment_objectKey_key";
DROP INDEX "MaterialBatchAttachment_objectKey_key";
CREATE UNIQUE INDEX "DistributorAttachment_distributorId_objectKey_key"
  ON "DistributorAttachment"("distributorId", "objectKey");
CREATE UNIQUE INDEX "MaterialBatchAttachment_batchId_objectKey_key"
  ON "MaterialBatchAttachment"("batchId", "objectKey");
