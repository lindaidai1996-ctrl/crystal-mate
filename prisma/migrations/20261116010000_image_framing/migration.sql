-- Preserve original files while storing responsive square cover settings.
ALTER TABLE "ProductImage" ADD COLUMN "framing" JSONB;
ALTER TABLE "MaterialImage" ADD COLUMN "framing" JSONB;
ALTER TABLE "MaterialBatchImage" ADD COLUMN "framing" JSONB;
