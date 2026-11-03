ALTER TABLE "MaterialImageImport" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Existing receipts already contain these IDs. Use the stock entry as the source of truth,
-- and clear references to records that were removed before foreign keys existed.
UPDATE "MaterialImageImportItem" AS item
SET "materialId" = entry."materialId"
FROM "MaterialBatchEntry" AS entry
WHERE item."entryId" = entry."id"
  AND item."materialId" IS DISTINCT FROM entry."materialId";

UPDATE "MaterialImageImportItem" AS item
SET "entryId" = NULL
WHERE item."entryId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "MaterialBatchEntry" WHERE "id" = item."entryId");

UPDATE "MaterialImageImportItem" AS item
SET "materialId" = NULL
WHERE item."materialId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Material" WHERE "id" = item."materialId");

CREATE INDEX "MaterialImageImportItem_materialId_idx" ON "MaterialImageImportItem"("materialId");

ALTER TABLE "MaterialImageImportItem" ADD CONSTRAINT "MaterialImageImportItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaterialImageImportItem" ADD CONSTRAINT "MaterialImageImportItem_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "MaterialBatchEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
