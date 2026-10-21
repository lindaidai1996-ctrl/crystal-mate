CREATE TABLE "ProductCode" (
    "code" TEXT NOT NULL,
    "prefix" TEXT,
    "sequence" INTEGER,
    "categoryId" TEXT NOT NULL,
    "productId" TEXT,
    "reservationToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCode_pkey" PRIMARY KEY ("code")
);

CREATE UNIQUE INDEX "ProductCode_reservationToken_key" ON "ProductCode"("reservationToken");
CREATE INDEX "ProductCode_prefix_sequence_idx" ON "ProductCode"("prefix", "sequence" DESC);

-- Use actual codes, including codes whose prefix no longer matches their category.
INSERT INTO "ProductCode" ("code", "prefix", "sequence", "categoryId", "productId", "createdAt")
SELECT
    "code",
    substring("code" FROM '^([A-Z]+)[0-9]{4}$'),
    CASE WHEN "code" ~ '^[A-Z]+[0-9]{4}$' THEN right("code", 4)::INTEGER END,
    "categoryId",
    "id",
    "createdAt"
FROM "Product";
