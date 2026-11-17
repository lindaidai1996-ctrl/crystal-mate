BEGIN;
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



COMMIT;
