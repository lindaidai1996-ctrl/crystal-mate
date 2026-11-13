CREATE TABLE "DiyCommonFeeSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "fees" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiyCommonFeeSettings_pkey" PRIMARY KEY ("id")
);
