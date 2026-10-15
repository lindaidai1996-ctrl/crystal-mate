CREATE TABLE "ProductMarketing" (
    "productId" TEXT NOT NULL,
    "videoShot" BOOLEAN NOT NULL DEFAULT false,
    "xiaohongshuVideoPublished" BOOLEAN NOT NULL DEFAULT false,
    "xiaohongshuListed" BOOLEAN NOT NULL DEFAULT false,
    "douyinVideoPublished" BOOLEAN NOT NULL DEFAULT false,
    "douyinListed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProductMarketing_pkey" PRIMARY KEY ("productId")
);

CREATE TABLE "CabochonMeasurement" (
    "productId" TEXT NOT NULL,
    "lengthMm" DECIMAL(10,2),
    "widthMm" DECIMAL(10,2),
    "heightMm" DECIMAL(10,2),
    CONSTRAINT "CabochonMeasurement_pkey" PRIMARY KEY ("productId"),
    CONSTRAINT "CabochonMeasurement_lengthMm_check" CHECK ("lengthMm" IS NULL OR "lengthMm" > 0),
    CONSTRAINT "CabochonMeasurement_widthMm_check" CHECK ("widthMm" IS NULL OR "widthMm" > 0),
    CONSTRAINT "CabochonMeasurement_heightMm_check" CHECK ("heightMm" IS NULL OR "heightMm" > 0),
    CONSTRAINT "CabochonMeasurement_has_dimension_check" CHECK (num_nonnulls("lengthMm", "widthMm", "heightMm") > 0)
);

ALTER TABLE "ProductMarketing" ADD CONSTRAINT "ProductMarketing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabochonMeasurement" ADD CONSTRAINT "CabochonMeasurement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProductMarketing" ("productId") SELECT "id" FROM "Product";
