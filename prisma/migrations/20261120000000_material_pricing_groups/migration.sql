BEGIN;
ALTER TABLE "ProductDiyRun" ADD COLUMN "legacySilver" BOOLEAN NOT NULL DEFAULT true;
-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "pricingGroupId" TEXT;

-- CreateTable
CREATE TABLE "MaterialPricingGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lossRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "marketLinked" BOOLEAN NOT NULL DEFAULT true,
    "marketCoefficient" DECIMAL(8,4) NOT NULL DEFAULT 1,
    "pricingRule" TEXT NOT NULL DEFAULT 'CUSTOM',
    "pricingValue" DECIMAL(12,2),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialPricingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialPricingPublication" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "saleGramPrice" DECIMAL(12,2) NOT NULL,
    "costBasis" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialPricingPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDiyPricingLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "lineCost" DECIMAL(12,2) NOT NULL,
    "quoteUnitPrice" DECIMAL(12,2) NOT NULL,
    "quoteLineTotal" DECIMAL(22,2) NOT NULL,
    "costSnapshot" JSONB NOT NULL,
    "costBasisToken" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ProductDiyPricingLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialPricingGroup_name_key" ON "MaterialPricingGroup"("name");

-- CreateIndex
CREATE INDEX "MaterialPricingPublication_groupId_createdAt_idx" ON "MaterialPricingPublication"("groupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialPricingPublication_groupId_version_key" ON "MaterialPricingPublication"("groupId", "version");

-- CreateIndex
CREATE INDEX "ProductDiyPricingLine_groupId_idx" ON "ProductDiyPricingLine"("groupId");

-- CreateIndex
CREATE INDEX "ProductDiyPricingLine_publicationId_idx" ON "ProductDiyPricingLine"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDiyPricingLine_runId_position_key" ON "ProductDiyPricingLine"("runId", "position");

-- CreateIndex
CREATE INDEX "Material_pricingGroupId_idx" ON "Material"("pricingGroupId");

-- AddForeignKey
ALTER TABLE "MaterialPricingPublication" ADD CONSTRAINT "MaterialPricingPublication_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MaterialPricingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDiyPricingLine" ADD CONSTRAINT "ProductDiyPricingLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductDiyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDiyPricingLine" ADD CONSTRAINT "ProductDiyPricingLine_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MaterialPricingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDiyPricingLine" ADD CONSTRAINT "ProductDiyPricingLine_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "MaterialPricingPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_pricingGroupId_fkey" FOREIGN KEY ("pricingGroupId") REFERENCES "MaterialPricingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "MaterialPricingGroup"
  ADD CONSTRAINT "MaterialPricingGroup_lossRate_check" CHECK ("lossRate" >= 0 AND "lossRate" < 100),
  ADD CONSTRAINT "MaterialPricingGroup_rule_check" CHECK ("pricingRule" IN ('PERCENT','FIXED','CUSTOM','MARGIN')),
  ADD CONSTRAINT "MaterialPricingGroup_value_check" CHECK ("pricingValue" >= 0 AND ("pricingRule" <> 'MARGIN' OR "pricingValue" < 100)),
  ADD CONSTRAINT "MaterialPricingGroup_coefficient_check" CHECK ("marketCoefficient" >= 0);
ALTER TABLE "MaterialPricingPublication" ADD CONSTRAINT "MaterialPricingPublication_price_check" CHECK ("saleGramPrice" >= 0);
ALTER TABLE "ProductDiyPricingLine" ADD CONSTRAINT "ProductDiyPricingLine_amounts_check"
  CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "quoteUnitPrice" >= 0 AND "lineCost" >= 0 AND "quoteLineTotal" >= 0);

CREATE OR REPLACE FUNCTION crystal_audit_root(model TEXT, data JSONB) RETURNS TEXT[]
LANGUAGE plpgsql AS $$
DECLARE parent_id TEXT;
BEGIN
  IF model='ProductCardAsset' THEN
    RETURN ARRAY[CASE WHEN data->>'productId' IS NULL THEN 'ProductCardAsset' ELSE 'Product' END,
      coalesce(data->>'productId', data->>'id')];
  ELSIF model IN ('ProductImage','ProductTag','ProductMarketing','CabochonMeasurement','CabochonCost',
               'CabochonExtraInfo','ProductPurchaseEntry','ProductDiyRun','ProductStockAdjustment','ProductCard') THEN
    RETURN ARRAY['Product', data->>'productId'];
  ELSIF model IN ('ProductDiyMaterial','ProductDiyCabochon','ProductDiyPricingLine') THEN
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
  ELSIF model='MaterialPricingPublication' THEN
    RETURN ARRAY['MaterialPricingGroup', data->>'groupId'];
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
CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "MaterialPricingGroup"
  FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();
CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "MaterialPricingPublication"
  FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();
CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "ProductDiyPricingLine"
  FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();

COMMIT;
