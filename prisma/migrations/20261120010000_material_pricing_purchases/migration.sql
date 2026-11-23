BEGIN;
ALTER TABLE "MaterialBatch" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "MaterialBatch" ADD CONSTRAINT "MaterialBatch_purpose_check" CHECK ("purpose" IN ('GENERAL', 'PRICING'));
ALTER TABLE "MaterialBatchEntry" ADD COLUMN "purchaseQuotePurpose" TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "MaterialBatchEntry" ADD CONSTRAINT "MaterialBatchEntry_quotePurpose_check" CHECK ("purchaseQuotePurpose" IN ('LEGACY', 'BEFORE_DISCOUNT'));
CREATE TABLE "MaterialPricingImport" (
  "id" UUID NOT NULL PRIMARY KEY,
  "fileHash" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "sheetName" TEXT NOT NULL,
  "rows" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "MaterialPricingImport_fileHash_sheetName_key" ON "MaterialPricingImport"("fileHash", "sheetName");
CREATE INDEX "MaterialPricingImport_updatedAt_idx" ON "MaterialPricingImport"("updatedAt");
CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "MaterialPricingImport"
  FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();
COMMIT;
