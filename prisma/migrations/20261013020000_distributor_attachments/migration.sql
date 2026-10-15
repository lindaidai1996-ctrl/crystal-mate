CREATE TABLE "DistributorAttachment" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistributorAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DistributorAttachment_objectKey_key" ON "DistributorAttachment"("objectKey");
CREATE UNIQUE INDEX "DistributorAttachment_distributorId_position_key" ON "DistributorAttachment"("distributorId", "position");
ALTER TABLE "DistributorAttachment" ADD CONSTRAINT "DistributorAttachment_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
