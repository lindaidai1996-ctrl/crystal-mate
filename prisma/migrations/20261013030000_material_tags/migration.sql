CREATE TABLE "MaterialTag" (
    "materialId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "MaterialTag_pkey" PRIMARY KEY ("materialId","tagId")
);

CREATE INDEX "MaterialTag_tagId_idx" ON "MaterialTag"("tagId");

ALTER TABLE "MaterialTag" ADD CONSTRAINT "MaterialTag_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaterialTag" ADD CONSTRAINT "MaterialTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
