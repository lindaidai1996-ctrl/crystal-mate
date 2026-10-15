CREATE TABLE "MaterialBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "receivedAt" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaterialBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaterialBatchEntry" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "remainingQty" INTEGER NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaterialBatchEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MaterialBatchEntry_receivedQty_check" CHECK ("receivedQty" > 0),
    CONSTRAINT "MaterialBatchEntry_remainingQty_check" CHECK ("remainingQty" >= 0 AND "remainingQty" <= "receivedQty")
);

CREATE TABLE "MaterialBatchImage" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "MaterialBatchImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialBatch_name_key" ON "MaterialBatch"("name");
CREATE INDEX "MaterialBatch_distributorId_idx" ON "MaterialBatch"("distributorId");
CREATE INDEX "MaterialBatch_receivedAt_idx" ON "MaterialBatch"("receivedAt");
CREATE UNIQUE INDEX "MaterialBatchEntry_materialId_batchId_key" ON "MaterialBatchEntry"("materialId", "batchId");
CREATE INDEX "MaterialBatchEntry_materialId_createdAt_idx" ON "MaterialBatchEntry"("materialId", "createdAt");
CREATE INDEX "MaterialBatchEntry_batchId_idx" ON "MaterialBatchEntry"("batchId");
CREATE UNIQUE INDEX "MaterialBatchImage_entryId_position_key" ON "MaterialBatchImage"("entryId", "position");

ALTER TABLE "MaterialBatch" ADD CONSTRAINT "MaterialBatch_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialBatchEntry" ADD CONSTRAINT "MaterialBatchEntry_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialBatchEntry" ADD CONSTRAINT "MaterialBatchEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialBatchImage" ADD CONSTRAINT "MaterialBatchImage_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "MaterialBatchEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
