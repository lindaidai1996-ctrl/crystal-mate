BEGIN;

UPDATE "Admin"
SET "nickname" = CASE "username" WHEN 'admin' THEN '豆子' WHEN 'admin2' THEN '呆呆' END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE ("username" = 'admin' AND "nickname" IS DISTINCT FROM '豆子')
   OR ("username" = 'admin2' AND "nickname" IS DISTINCT FROM '呆呆');

-- The owner confirmed admin2 created all records whose historical creator is unknown.
-- Preserve existing creators, editor identities, timestamps, and append-only audit events.
UPDATE "RecordAttribution"
SET "createdBy" = (
  SELECT jsonb_build_object('id', "id", 'username', "username", 'nickname', "nickname")
  FROM "Admin" WHERE "username" = 'admin2'
)
WHERE ("createdBy" IS NULL OR "createdBy" = 'null'::jsonb)
  AND EXISTS (SELECT 1 FROM "Admin" WHERE "username" = 'admin2');

COMMIT;
