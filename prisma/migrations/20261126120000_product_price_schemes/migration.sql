-- CreateTable
CREATE TABLE "PriceScheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "rounding" TEXT NOT NULL DEFAULT 'CENT',
    "common" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSchemeRevision" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "formula" TEXT NOT NULL,
    "rounding" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSchemeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSchemePrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'AUTO',
    "amountCents" INTEGER,
    "previousAmountCents" INTEGER,
    "error" TEXT,
    "schemeVersion" INTEGER NOT NULL,
    "basis" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSchemePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceScheme_name_key" ON "PriceScheme"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSchemeRevision_schemeId_version_key" ON "PriceSchemeRevision"("schemeId", "version");

-- CreateIndex
CREATE INDEX "ProductSchemePrice_schemeId_idx" ON "ProductSchemePrice"("schemeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSchemePrice_productId_schemeId_key" ON "ProductSchemePrice"("productId", "schemeId");

-- AddForeignKey
ALTER TABLE "PriceSchemeRevision" ADD CONSTRAINT "PriceSchemeRevision_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "PriceScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSchemePrice" ADD CONSTRAINT "ProductSchemePrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSchemePrice" ADD CONSTRAINT "ProductSchemePrice_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "PriceScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "PriceScheme"
FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();
CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "PriceSchemeRevision"
FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();
CREATE TRIGGER crystal_audit AFTER INSERT OR UPDATE OR DELETE ON "ProductSchemePrice"
FOR EACH ROW EXECUTE FUNCTION crystal_capture_audit();
ALTER TABLE "PriceScheme" ADD CONSTRAINT "PriceScheme_rounding_check" CHECK ("rounding" IN ('CENT', 'YUAN_UP', 'TEN_UP'));
ALTER TABLE "ProductSchemePrice" ADD CONSTRAINT "ProductSchemePrice_mode_check" CHECK ("mode" IN ('AUTO', 'MANUAL', 'RETAIN'));
ALTER TABLE "ProductSchemePrice" ADD CONSTRAINT "ProductSchemePrice_amount_check" CHECK ("amountCents" >= 0 AND "previousAmountCents" >= 0);
