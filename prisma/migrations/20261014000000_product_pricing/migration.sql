CREATE TYPE "ProductSaleRule" AS ENUM (
  'COST', 'PERCENT_30', 'PERCENT_50', 'PERCENT_100', 'PERCENT_200',
  'FIXED_AMOUNT', 'CUSTOM_PERCENT'
);

-- Preserve existing prices as manual prices; new editors explicitly opt into automatic pricing.
ALTER TABLE "Product"
  ADD COLUMN "saleRule" "ProductSaleRule" NOT NULL DEFAULT 'PERCENT_50',
  ADD COLUMN "saleRuleValue" DECIMAL(12,2),
  ADD COLUMN "saleManual" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Product" ADD CONSTRAINT "Product_saleRuleValue_nonnegative"
  CHECK ("saleRuleValue" IS NULL OR "saleRuleValue" >= 0);
