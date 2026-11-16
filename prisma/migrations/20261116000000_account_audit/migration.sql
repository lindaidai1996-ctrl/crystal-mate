BEGIN;

ALTER TABLE "EditorDraft" ADD COLUMN "ownerId" TEXT;
CREATE INDEX "EditorDraft_ownerId_kind_updatedAt_idx" ON "EditorDraft"("ownerId", "kind", "updatedAt" DESC);

CREATE TABLE "RecordAttribution" (
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityLabel" TEXT NOT NULL,
  "rootType" TEXT NOT NULL,
  "rootId" TEXT NOT NULL,
  "createdBy" JSONB,
  "updatedBy" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  PRIMARY KEY ("entityType", "entityId")
);
CREATE INDEX "RecordAttribution_rootType_rootId_idx" ON "RecordAttribution"("rootType", "rootId");

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "operationId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "actorId" TEXT,
  "actorUsername" TEXT,
  "actorNickname" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityLabel" TEXT NOT NULL,
  "rootType" TEXT NOT NULL,
  "rootId" TEXT NOT NULL,
  "relatedIds" TEXT[] NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "changedFields" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt" DESC, "id");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt" DESC);
CREATE INDEX "AuditLog_rootType_rootId_createdAt_idx" ON "AuditLog"("rootType", "rootId", "createdAt" DESC);
CREATE INDEX "AuditLog_operationId_idx" ON "AuditLog"("operationId");
CREATE INDEX "AuditLog_relatedIds_idx" ON "AuditLog" USING GIN ("relatedIds");

CREATE FUNCTION crystal_audit_identity(model TEXT, data JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE model
    WHEN 'ProductCode' THEN data->>'code'
    WHEN 'ProductTag' THEN (data->>'productId') || ':' || (data->>'tagId')
    WHEN 'MaterialTag' THEN (data->>'materialId') || ':' || (data->>'tagId')
    ELSE coalesce(data->>'id', data->>'productId', data->>'materialId', data->>'code') END
$$;

-- Parent IDs are resolved while rows still exist (including cascade-trigger execution).
CREATE FUNCTION crystal_audit_root(model TEXT, data JSONB) RETURNS TEXT[]
LANGUAGE plpgsql AS $$
DECLARE parent_id TEXT;
BEGIN
  IF model IN ('ProductImage','ProductTag','ProductMarketing','CabochonMeasurement','CabochonCost',
               'CabochonExtraInfo','ProductPurchaseEntry','ProductDiyRun','ProductStockAdjustment') THEN
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

CREATE FUNCTION crystal_capture_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous JSONB;
  current_row JSONB;
  record_row JSONB;
  context JSONB;
  actor JSONB;
  root TEXT[];
  entity_id TEXT;
  entity_label TEXT;
  fields TEXT[];
  ignored TEXT[] := ARRAY['createdAt','updatedAt','sessionVersion','runToken','leaseUntil','version','reservationToken'];
  hidden TEXT[] := ARRAY['data','rows','settings','warnings','quoteSnapshot','purchaseUnitInputs'];
  field_name TEXT;
  related TEXT[];
  event_time TIMESTAMP(3) := clock_timestamp();
BEGIN
  IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN current_row := to_jsonb(NEW); END IF;
  record_row := coalesce(current_row, previous);
  SELECT array_agg(key ORDER BY key) INTO fields FROM (
    SELECT key FROM jsonb_object_keys(coalesce(previous,'{}') || coalesce(current_row,'{}')) AS key
    WHERE NOT key=ANY(ignored)
      AND (previous->key IS DISTINCT FROM current_row->key)
  ) changed;
  IF fields IS NULL THEN RETURN NULL; END IF;

  context := nullif(current_setting('crystal.audit_context',true),'')::jsonb;
  actor := context->'actor';
  entity_id := crystal_audit_identity(TG_TABLE_NAME,record_row);
  root := crystal_audit_root(TG_TABLE_NAME,record_row);
  entity_label := coalesce(nullif(record_row->>'name',''), nullif(record_row->>'title',''),
    nullif(record_row->>'magicBoxStyle',''), nullif(record_row->>'username',''),
    nullif(record_row->>'fileName',''), record_row->>'code');
  IF entity_label IS NULL THEN
    SELECT "entityLabel" INTO entity_label FROM "RecordAttribution"
      WHERE "entityType"=root[1] AND "entityId"=root[2];
  END IF;
  entity_label := coalesce(entity_label,entity_id);
  IF record_row ? 'code' AND record_row ? 'name' THEN
    entity_label := (record_row->>'code') || ' · ' || entity_label;
  END IF;
  SELECT array_agg(DISTINCT value) INTO related FROM (
    SELECT value FROM jsonb_each_text(coalesce(previous,'{}') || coalesce(current_row,'{}')) WHERE key LIKE '%Id' AND value IS NOT NULL
    UNION SELECT value FROM jsonb_each_text(coalesce(previous,'{}')) WHERE key LIKE '%Id' AND value IS NOT NULL
    UNION SELECT entity_id UNION SELECT root[2]
  ) links;

  -- Never persist password material. A password change is represented as an event only.
  IF 'passwordHash'=ANY(fields) THEN
    fields := array_remove(fields,'passwordHash') || ARRAY['passwordChanged'];
    IF current_row IS NOT NULL THEN current_row := current_row || '{"passwordChanged":true}'; END IF;
  END IF;
  previous := previous - ignored - ARRAY['passwordHash'];
  current_row := current_row - ignored - ARRAY['passwordHash'];
  FOREACH field_name IN ARRAY hidden LOOP
    IF previous ? field_name THEN previous := jsonb_set(previous,ARRAY[field_name],'"[内容已隐藏]"'); END IF;
    IF current_row ? field_name THEN current_row := jsonb_set(current_row,ARRAY[field_name],'"[内容已隐藏]"'); END IF;
  END LOOP;

  INSERT INTO "AuditLog" ("operationId","source","actorId","actorUsername","actorNickname","action",
    "entityType","entityId","entityLabel","rootType","rootId","relatedIds","before","after","changedFields","createdAt")
  VALUES (coalesce(context->>'operationId','system:' || txid_current()::text),coalesce(context->>'source','SYSTEM'),
    actor->>'id',actor->>'username',actor->>'nickname',TG_OP,TG_TABLE_NAME,entity_id,entity_label,
    root[1],root[2],related,previous,current_row,fields,event_time);

  actor := coalesce(actor,'{"id":"SYSTEM","username":"SYSTEM","nickname":""}'::jsonb);
  INSERT INTO "RecordAttribution" ("entityType","entityId","entityLabel","rootType","rootId",
    "createdBy","updatedBy","createdAt","updatedAt","deletedAt")
  VALUES (TG_TABLE_NAME,entity_id,entity_label,root[1],root[2],
    CASE WHEN TG_OP='INSERT' THEN actor ELSE NULL END,actor,
    coalesce((record_row->>'createdAt')::timestamp,event_time),event_time,
    CASE WHEN TG_OP='DELETE' THEN event_time ELSE NULL END)
  ON CONFLICT ("entityType","entityId") DO UPDATE SET
    "entityLabel"=EXCLUDED."entityLabel","updatedBy"=EXCLUDED."updatedBy","updatedAt"=event_time,
    "deletedAt"=EXCLUDED."deletedAt";

  IF root[1] <> TG_TABLE_NAME OR root[2] <> entity_id THEN
    UPDATE "RecordAttribution" SET "updatedBy"=actor,"updatedAt"=event_time
      WHERE "entityType"=root[1] AND "entityId"=root[2];
  END IF;
  RETURN NULL;
END $$;

-- Historical rows keep their actual timestamps; creator/editor identities stay unknown.
DO $$
DECLARE model TEXT; row_data JSONB; root TEXT[]; entity_id TEXT; label TEXT;
BEGIN
  FOREACH model IN ARRAY ARRAY[
    'Admin','Category','Tag','DistributorArea','Distributor','MaterialCategory','Material',
    'MaterialBatch','Product','SettingStyle','SilverPricing','DiyCommonFeeSettings','EditorDraft',
    'ProductCode','CabochonExcelImport','MaterialImageImport','DiyImageImport',
    'DistributorAttachment','ProductPurchaseEntry','ProductDiyRun','ProductDiyMaterial','ProductDiyCabochon',
    'ProductStockAdjustment','ProductMarketing','CabochonMeasurement','CabochonCost','CabochonExtraInfo',
    'ProductTag','ProductImage','MaterialBatchEntry','MaterialStockAdjustment','MaterialBatchAttachment',
    'MaterialBatchImage','MaterialImage','MaterialTag','MaterialImageImportItem'
  ] LOOP
    FOR row_data IN EXECUTE format('SELECT to_jsonb(t) FROM %I t',model) LOOP
      entity_id := crystal_audit_identity(model,row_data);
      root := crystal_audit_root(model,row_data);
      label := coalesce(nullif(row_data->>'name',''),nullif(row_data->>'title',''),
        row_data->>'magicBoxStyle',row_data->>'username',row_data->>'fileName',row_data->>'code',entity_id);
      INSERT INTO "RecordAttribution" ("entityType","entityId","entityLabel","rootType","rootId","createdAt","updatedAt")
      VALUES (model,entity_id,label,root[1],root[2],
        coalesce((row_data->>'createdAt')::timestamp,CURRENT_TIMESTAMP),
        coalesce((row_data->>'updatedAt')::timestamp,(row_data->>'createdAt')::timestamp,CURRENT_TIMESTAMP));
    END LOOP;
    EXECUTE format('CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit()',model);
  END LOOP;
END $$;

CREATE FUNCTION crystal_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operation history is append-only'; END $$;
CREATE TRIGGER crystal_audit_immutable BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION crystal_audit_append_only();

COMMIT;
