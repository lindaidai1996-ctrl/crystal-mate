-- CreateTable
CREATE TABLE "SettingStyle" (
    "id" TEXT NOT NULL,
    "magicBoxStyle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettingStyle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CabochonExtraInfo" (
    "productId" TEXT NOT NULL,
    "settingStyleId" TEXT,

    CONSTRAINT "CabochonExtraInfo_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SettingStyle_magicBoxStyle_key" ON "SettingStyle"("magicBoxStyle");

-- CreateIndex
CREATE INDEX "CabochonExtraInfo_settingStyleId_idx" ON "CabochonExtraInfo"("settingStyleId");

-- AddForeignKey
ALTER TABLE "CabochonExtraInfo" ADD CONSTRAINT "CabochonExtraInfo_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabochonExtraInfo" ADD CONSTRAINT "CabochonExtraInfo_settingStyleId_fkey" FOREIGN KEY ("settingStyleId") REFERENCES "SettingStyle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
