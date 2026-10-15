CREATE TYPE "ProductOrigin" AS ENUM ('PURCHASED', 'DIY');
CREATE TYPE "DiyUsageUnit" AS ENUM ('STRAND', 'BEAD', 'GRAM');

ALTER TABLE "Product" ADD COLUMN "origin" "ProductOrigin";

CREATE TABLE "ProductPurchaseEntry" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductPurchaseEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductPurchaseEntry_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "ProductDiyRun" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "perUnitCost" DECIMAL(12,2) NOT NULL,
    "extraCosts" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductDiyRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductDiyRun_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "ProductDiyMaterial" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "materialBatchEntryId" TEXT NOT NULL,
    "usageUnit" "DiyUsageUnit" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "lineCost" DECIMAL(12,2) NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "ProductDiyMaterial_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductDiyMaterial_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "ProductDiyCabochon" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "lineCost" DECIMAL(12,2) NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "ProductDiyCabochon_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductDiyCabochon_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "ProductStockAdjustment" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductStockAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductStockAdjustment_delta_check" CHECK ("delta" <> 0)
);

CREATE INDEX "ProductPurchaseEntry_productId_createdAt_idx" ON "ProductPurchaseEntry"("productId", "createdAt");
CREATE INDEX "ProductPurchaseEntry_batchId_idx" ON "ProductPurchaseEntry"("batchId");
CREATE INDEX "ProductPurchaseEntry_distributorId_idx" ON "ProductPurchaseEntry"("distributorId");
CREATE INDEX "ProductDiyRun_productId_createdAt_idx" ON "ProductDiyRun"("productId", "createdAt");
CREATE UNIQUE INDEX "ProductDiyMaterial_runId_position_key" ON "ProductDiyMaterial"("runId", "position");
CREATE INDEX "ProductDiyMaterial_materialBatchEntryId_idx" ON "ProductDiyMaterial"("materialBatchEntryId");
CREATE UNIQUE INDEX "ProductDiyCabochon_runId_position_key" ON "ProductDiyCabochon"("runId", "position");
CREATE INDEX "ProductDiyCabochon_productId_idx" ON "ProductDiyCabochon"("productId");
CREATE INDEX "ProductStockAdjustment_productId_createdAt_idx" ON "ProductStockAdjustment"("productId", "createdAt");

ALTER TABLE "ProductPurchaseEntry" ADD CONSTRAINT "ProductPurchaseEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductPurchaseEntry" ADD CONSTRAINT "ProductPurchaseEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductPurchaseEntry" ADD CONSTRAINT "ProductPurchaseEntry_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductDiyRun" ADD CONSTRAINT "ProductDiyRun_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductDiyMaterial" ADD CONSTRAINT "ProductDiyMaterial_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductDiyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductDiyMaterial" ADD CONSTRAINT "ProductDiyMaterial_materialBatchEntryId_fkey" FOREIGN KEY ("materialBatchEntryId") REFERENCES "MaterialBatchEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductDiyCabochon" ADD CONSTRAINT "ProductDiyCabochon_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductDiyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductDiyCabochon" ADD CONSTRAINT "ProductDiyCabochon_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStockAdjustment" ADD CONSTRAINT "ProductStockAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ProductStockAdjustment" ("id", "productId", "delta", "reason")
SELECT 'opening-' || "id", "id", "stock", '历史库存初始余额'
FROM "Product" WHERE "stock" > 0;
