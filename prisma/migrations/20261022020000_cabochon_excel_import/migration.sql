CREATE TABLE "CabochonExcelImport" (
    "id" UUID NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CabochonExcelImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CabochonExcelImport_fileHash_sheetName_idx" ON "CabochonExcelImport"("fileHash", "sheetName");
CREATE INDEX "CabochonExcelImport_updatedAt_idx" ON "CabochonExcelImport"("updatedAt");
