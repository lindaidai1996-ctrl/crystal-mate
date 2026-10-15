ALTER TABLE "ProductDiyRun"
    ADD COLUMN "totalCost" DECIMAL(22,2),
    ADD COLUMN "craftDesignFee" JSONB NOT NULL
    DEFAULT '{"unitAmount":"0","accumulateByQuantity":false,"totalAmount":null}';
