BEGIN;
CREATE TABLE "ProductCard" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "runId" TEXT REFERENCES "ProductDiyRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL DEFAULT 1,
  "data" JSONB NOT NULL,
  "quoteSnapshot" JSONB,
  "sourceSnapshot" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ProductCard_productId_updatedAt_idx" ON "ProductCard"("productId", "updatedAt");
CREATE INDEX "ProductCard_runId_idx" ON "ProductCard"("runId");
CREATE TABLE "ProductCardAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sourceKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ProductCardAsset_storageKey_key" ON "ProductCardAsset"("storageKey");
CREATE INDEX "ProductCardAsset_productId_sourceKey_idx" ON "ProductCardAsset"("productId", "sourceKey");
CREATE TABLE "ProductCardBrandSettings" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  "data" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE OR REPLACE FUNCTION crystal_audit_root(model TEXT, data JSONB) RETURNS TEXT[]
LANGUAGE plpgsql AS $$
DECLARE parent_id TEXT;
BEGIN
  IF model IN ('ProductImage','ProductTag','ProductMarketing','CabochonMeasurement','CabochonCost',
               'CabochonExtraInfo','ProductPurchaseEntry','ProductDiyRun','ProductStockAdjustment','ProductCard','ProductCardAsset') THEN
    RETURN ARRAY['Product', data->>'productId'];
  ELSIF model IN ('ProductDiyMaterial','ProductDiyCabochon') THEN
    SELECT "productId" INTO parent_id FROM "ProductDiyRun" WHERE id=data->>'runId';
    IF parent_id IS NULL THEN
      SELECT "rootId" INTO parent_id FROM "RecordAttribution"
        WHERE "entityType"='ProductDiyRun' AND "entityId"=data->>'runId';
    END IF;
    RETURN ARRAY['Product', coalesce(parent_id, data->>'runId')];
  ELSIF model IN ('MaterialImage','MaterialTag','MaterialBatchEntry') THEN
    RETURN ARRAY['Material', data->>'materialId'];
  ELSIF model='MaterialStockAdjustment' THEN
    SELECT "materialId" INTO parent_id FROM "MaterialBatchEntry" WHERE id=data->>'entryId';
    IF parent_id IS NULL THEN
      SELECT "rootId" INTO parent_id FROM "RecordAttribution"
        WHERE "entityType"='MaterialBatchEntry' AND "entityId"=data->>'entryId';
    END IF;
    RETURN ARRAY['Material', coalesce(parent_id, data->>'entryId')];
  ELSIF model='DistributorAttachment' THEN
    RETURN ARRAY['Distributor', data->>'distributorId'];
  ELSIF model='MaterialBatchAttachment' THEN
    RETURN ARRAY['MaterialBatch', data->>'batchId'];
  ELSIF model='MaterialBatchImage' THEN
    SELECT "materialId" INTO parent_id FROM "MaterialBatchEntry" WHERE id=data->>'entryId';
    IF parent_id IS NULL THEN
      SELECT "rootId" INTO parent_id FROM "RecordAttribution"
        WHERE "entityType"='MaterialBatchEntry' AND "entityId"=data->>'entryId';
    END IF;
    RETURN ARRAY['Material', coalesce(parent_id, data->>'entryId')];
  ELSIF model='MaterialImageImportItem' THEN
    RETURN ARRAY['MaterialImageImport', data->>'importId'];
  END IF;
  RETURN ARRAY[model, crystal_audit_identity(model,data)];
END $$;


CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "ProductCard"
  FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();
CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "ProductCardAsset"
  FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();
CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "ProductCardBrandSettings"
  FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();

COMMIT;
