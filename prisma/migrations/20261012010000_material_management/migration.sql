CREATE TYPE "MaterialUnit" AS ENUM ('STRAND', 'BEAD');
CREATE TYPE "MaterialPriceSource" AS ENUM ('COUNT', 'WEIGHT', 'CUSTOM');
CREATE TYPE "MaterialSaleRule" AS ENUM ('COST', 'PERCENT_10', 'PERCENT_20', 'PERCENT_30', 'PERCENT_50', 'FIXED_AMOUNT', 'CUSTOM_PERCENT');

CREATE TABLE "MaterialCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaterialCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "unit" "MaterialUnit" NOT NULL DEFAULT 'STRAND',
    "purchaseUnitPrice" DECIMAL(12,2),
    "weightGrams" DECIMAL(12,2),
    "purchaseGramPrice" DECIMAL(12,2),
    "purchaseGramManual" BOOLEAN NOT NULL DEFAULT false,
    "lengthMm" DECIMAL(12,2),
    "widthMm" DECIMAL(12,2),
    "heightMm" DECIMAL(12,2),
    "childCount" INTEGER,
    "childWeightGrams" DECIMAL(12,2),
    "childUnitPrice" DECIMAL(12,2),
    "childPriceSource" "MaterialPriceSource",
    "saleRule" "MaterialSaleRule" NOT NULL DEFAULT 'COST',
    "saleRuleValue" DECIMAL(12,2),
    "saleUnitPrice" DECIMAL(12,2),
    "saleGramPrice" DECIMAL(12,2),
    "saleChildUnitPrice" DECIMAL(12,2),
    "saleUnitManual" BOOLEAN NOT NULL DEFAULT false,
    "saleGramManual" BOOLEAN NOT NULL DEFAULT false,
    "saleChildManual" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Material_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Material_childCount_check" CHECK ("childCount" IS NULL OR "childCount" > 0)
);

CREATE TABLE "MaterialImage" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "MaterialImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialCategory_parentId_idx" ON "MaterialCategory"("parentId");
CREATE UNIQUE INDEX "MaterialCategory_sibling_name_key" ON "MaterialCategory"(COALESCE("parentId", ''), "name");
CREATE INDEX "Material_categoryId_idx" ON "Material"("categoryId");
CREATE INDEX "Material_createdAt_idx" ON "Material"("createdAt");
CREATE UNIQUE INDEX "MaterialImage_materialId_position_key" ON "MaterialImage"("materialId", "position");

ALTER TABLE "MaterialCategory" ADD CONSTRAINT "MaterialCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MaterialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Material" ADD CONSTRAINT "Material_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaterialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialImage" ADD CONSTRAINT "MaterialImage_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;
