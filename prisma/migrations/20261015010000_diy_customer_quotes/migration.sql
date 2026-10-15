ALTER TABLE "ProductDiyRun"
    ADD COLUMN "perUnitQuote" DECIMAL(22,2),
    ADD COLUMN "totalQuote" DECIMAL(22,2);

ALTER TABLE "ProductDiyMaterial"
    ADD COLUMN "quoteUnitPrice" DECIMAL(12,2),
    ADD COLUMN "quoteLineTotal" DECIMAL(22,2),
    ADD COLUMN "quoteSnapshot" JSONB;

ALTER TABLE "ProductDiyCabochon"
    ADD COLUMN "quoteUnitPrice" DECIMAL(12,2),
    ADD COLUMN "quoteLineTotal" DECIMAL(22,2),
    ADD COLUMN "quoteSnapshot" JSONB;
