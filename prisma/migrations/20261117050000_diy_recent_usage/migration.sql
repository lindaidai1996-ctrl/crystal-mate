CREATE TABLE "DiyRecentMaterial" (
  "ownerId" TEXT NOT NULL REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "entryId" TEXT NOT NULL REFERENCES "MaterialBatchEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("ownerId", "entryId")
);
CREATE INDEX "DiyRecentMaterial_ownerId_usedAt_idx" ON "DiyRecentMaterial"("ownerId", "usedAt" DESC);
CREATE TABLE "DiyRecentCabochon" (
  "ownerId" TEXT NOT NULL REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("ownerId", "productId")
);
CREATE INDEX "DiyRecentCabochon_ownerId_usedAt_idx" ON "DiyRecentCabochon"("ownerId", "usedAt" DESC);
