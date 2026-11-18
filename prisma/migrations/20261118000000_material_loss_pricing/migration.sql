-- Preserve existing effective prices and seed the separate baseline without repricing history.
ALTER TABLE "Material"
  ADD COLUMN "lossRate" DECIMAL(5,2),
  ADD COLUMN "baseSaleUnitPrice" DECIMAL(12,2),
  ADD COLUMN "baseSaleGramPrice" DECIMAL(12,2),
  ADD COLUMN "baseSaleChildUnitPrice" DECIMAL(12,2),
  ADD CONSTRAINT "Material_lossRate_check" CHECK ("lossRate" >= 0 AND "lossRate" < 100);

ALTER TABLE "MaterialBatchEntry"
  ADD COLUMN "lossRate" DECIMAL(5,2),
  ADD COLUMN "baseSaleUnitPrice" DECIMAL(12,2),
  ADD COLUMN "baseSaleGramPrice" DECIMAL(12,2),
  ADD COLUMN "baseSaleChildUnitPrice" DECIMAL(12,2),
  ADD CONSTRAINT "MaterialBatchEntry_lossRate_check" CHECK ("lossRate" >= 0 AND "lossRate" < 100);

UPDATE "Material" SET
  "baseSaleUnitPrice" = "saleUnitPrice",
  "baseSaleGramPrice" = "saleGramPrice",
  "baseSaleChildUnitPrice" = "saleChildUnitPrice";
UPDATE "MaterialBatchEntry" SET
  "baseSaleUnitPrice" = "saleUnitPrice",
  "baseSaleGramPrice" = "saleGramPrice",
  "baseSaleChildUnitPrice" = "saleChildUnitPrice";
