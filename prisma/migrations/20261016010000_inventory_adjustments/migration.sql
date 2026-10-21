ALTER TABLE "ProductStockAdjustment"
  ADD COLUMN "beforeQty" INTEGER,
  ADD COLUMN "afterQty" INTEGER;

CREATE TABLE "MaterialStockAdjustment" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "beforeQty" INTEGER,
  "afterQty" INTEGER NOT NULL,
  "delta" INTEGER,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialStockAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MaterialStockAdjustment_afterQty_check" CHECK ("afterQty" >= 0),
  CONSTRAINT "MaterialStockAdjustment_beforeQty_check" CHECK ("beforeQty" IS NULL OR "beforeQty" >= 0)
);

CREATE INDEX "MaterialStockAdjustment_entryId_createdAt_idx"
  ON "MaterialStockAdjustment"("entryId", "createdAt");
ALTER TABLE "MaterialStockAdjustment" ADD CONSTRAINT "MaterialStockAdjustment_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "MaterialBatchEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Purchase history and physical inventory are independent after a stock count.
ALTER TABLE "MaterialBatchEntry" DROP CONSTRAINT "MaterialBatchEntry_quantity_check";
ALTER TABLE "MaterialBatchEntry" ADD CONSTRAINT "MaterialBatchEntry_quantity_check" CHECK (
  ("receivedQty" IS NOT NULL AND "receivedQty" > 0) OR
  ("receivedQty" IS NULL AND "purchaseInputMode" = 'BATCH')
);
ALTER TABLE "MaterialBatchEntry" ADD CONSTRAINT "MaterialBatchEntry_remainingQty_check"
  CHECK ("remainingQty" IS NULL OR "remainingQty" >= 0);
