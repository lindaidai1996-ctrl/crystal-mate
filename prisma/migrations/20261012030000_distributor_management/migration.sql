CREATE TABLE "DistributorArea" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistributorArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Distributor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "wechat" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Distributor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DistributorArea_name_key" ON "DistributorArea"("name");
CREATE INDEX "Distributor_area_idx" ON "Distributor"("area");
CREATE INDEX "Distributor_createdAt_idx" ON "Distributor"("createdAt");
