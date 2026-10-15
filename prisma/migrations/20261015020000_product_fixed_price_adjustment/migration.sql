ALTER TABLE "Product"
    DROP CONSTRAINT "Product_saleRuleValue_nonnegative",
    ADD CONSTRAINT "Product_saleRuleValue_valid"
    CHECK (
        "saleRuleValue" IS NULL
        OR "saleRule" = 'FIXED_AMOUNT'
        OR "saleRuleValue" >= 0
    );
