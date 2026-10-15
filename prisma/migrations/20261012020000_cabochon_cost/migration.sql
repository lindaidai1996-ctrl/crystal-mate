CREATE TABLE "CabochonCost" (
    "productId" TEXT NOT NULL,
    "roughStoneCost" DECIMAL(12,2),
    "settingCost" DECIMAL(12,2),
    "otherCosts" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "totalManual" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CabochonCost_pkey" PRIMARY KEY ("productId"),
    CONSTRAINT "CabochonCost_roughStoneCost_check" CHECK ("roughStoneCost" IS NULL OR "roughStoneCost" >= 0),
    CONSTRAINT "CabochonCost_settingCost_check" CHECK ("settingCost" IS NULL OR "settingCost" >= 0),
    CONSTRAINT "CabochonCost_totalCost_check" CHECK ("totalCost" >= 0)
);

ALTER TABLE "CabochonCost" ADD CONSTRAINT "CabochonCost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
