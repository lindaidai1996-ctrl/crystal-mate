BEGIN;
ALTER TABLE "MaterialPricingImport" ADD COLUMN "execution" JSONB;

-- Keep worker tokens and internal checkpoints out of audit snapshots, just like rows.
-- Preserve the existing audit function, including any earlier schema maintenance.
DO $migration$
DECLARE
  definition TEXT := pg_get_functiondef('crystal_capture_audit()'::regprocedure);
  updated_definition TEXT;
BEGIN
  updated_definition := replace(definition,
    'hidden TEXT[] := ARRAY[', 'hidden TEXT[] := ARRAY[''execution'',');
  IF updated_definition = definition THEN
    RAISE EXCEPTION 'Cannot extend the audit snapshot redaction fields';
  END IF;
  EXECUTE updated_definition;
END $migration$;
COMMIT;
