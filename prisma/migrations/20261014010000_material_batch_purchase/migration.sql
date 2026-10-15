ALTER TABLE "MaterialBatchEntry"
  ALTER COLUMN "receivedQty" DROP NOT NULL,
  ALTER COLUMN "remainingQty" DROP NOT NULL,
  ADD COLUMN "purchaseInputMode" TEXT NOT NULL DEFAULT 'UNIT',
  ADD COLUMN "purchaseTotalWeightGrams" DECIMAL(12,2),
  ADD COLUMN "purchaseTotalAmount" DECIMAL(12,2),
  ADD COLUMN "purchaseQuotedGramPrice" DECIMAL(12,2),
  ADD COLUMN "purchaseAutoField" TEXT,
  ADD COLUMN "sampleWeightGrams" DECIMAL(12,2),
  ADD COLUMN "manualPurchaseUnitPrice" DECIMAL(12,2),
  ADD COLUMN "purchaseUnitInputs" JSONB,
  ADD COLUMN "unitPriceSource" TEXT NOT NULL DEFAULT 'UNIT',
  DROP CONSTRAINT "MaterialBatchEntry_receivedQty_check",
  DROP CONSTRAINT "MaterialBatchEntry_remainingQty_check";
ALTER TABLE "MaterialBatchEntry"
  ADD CONSTRAINT "MaterialBatchEntry_quantity_check" CHECK (
    ("receivedQty" IS NULL AND "remainingQty" IS NULL AND "purchaseInputMode" = 'BATCH') OR
    ("receivedQty" IS NOT NULL AND "remainingQty" IS NOT NULL AND "receivedQty" > 0 AND "remainingQty" >= 0 AND "remainingQty" <= "receivedQty")
  ),
  ADD CONSTRAINT "MaterialBatchEntry_purchase_mode_check" CHECK ("purchaseInputMode" IN ('UNIT', 'BATCH'));
