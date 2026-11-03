-- CreateTable
CREATE TABLE "MaterialImageImport" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "errorCode" TEXT,
    "runToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialImageImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialImageImportItem" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "materialId" TEXT,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialImageImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialImageImport_sourceKey_key" ON "MaterialImageImport"("sourceKey");

-- CreateIndex
CREATE INDEX "MaterialImageImport_createdAt_idx" ON "MaterialImageImport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialImageImportItem_entryId_key" ON "MaterialImageImportItem"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialImageImportItem_importId_position_key" ON "MaterialImageImportItem"("importId", "position");

-- AddForeignKey
ALTER TABLE "MaterialImageImportItem" ADD CONSTRAINT "MaterialImageImportItem_importId_fkey" FOREIGN KEY ("importId") REFERENCES "MaterialImageImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

