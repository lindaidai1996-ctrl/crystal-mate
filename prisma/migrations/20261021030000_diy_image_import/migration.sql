CREATE TABLE "DiyImageImport" (
    "id" TEXT NOT NULL,
    "images" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "promptVersion" TEXT NOT NULL DEFAULT '',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "errorCode" TEXT,
    "runToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "productId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DiyImageImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiyImageImport_runId_key" ON "DiyImageImport"("runId");
CREATE INDEX "DiyImageImport_createdAt_idx" ON "DiyImageImport"("createdAt");
CREATE INDEX "DiyImageImport_productId_idx" ON "DiyImageImport"("productId");
ALTER TABLE "DiyImageImport" ADD CONSTRAINT "DiyImageImport_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiyImageImport" ADD CONSTRAINT "DiyImageImport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductDiyRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
