ALTER TABLE "ProductDiyRun"
ADD COLUMN "silverWeightGrams" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "silverCostGramPrice" DECIMAL(12,2) NOT NULL DEFAULT 20,
ADD COLUMN "silverQuoteGramPrice" DECIMAL(12,2) NOT NULL DEFAULT 30;

CREATE TABLE "SilverPricing" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "costGramPrice" DECIMAL(12,2) NOT NULL DEFAULT 20,
    "quoteGramPrice" DECIMAL(12,2) NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SilverPricing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SilverPricing_singleton" CHECK ("id" = 'default')
);
