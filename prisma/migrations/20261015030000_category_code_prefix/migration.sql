ALTER TABLE "Category" ADD COLUMN "prefix" TEXT;

DO $$
DECLARE
  category_row RECORD;
  category_index INTEGER := 0;
  prefix_value TEXT;
  remainder INTEGER;
BEGIN
  FOR category_row IN SELECT "id" FROM "Category" ORDER BY "createdAt", "id" LOOP
    prefix_value := '';
    remainder := category_index;
    LOOP
      prefix_value := chr(65 + (remainder % 26)) || prefix_value;
      remainder := (remainder / 26) - 1;
      EXIT WHEN remainder < 0;
    END LOOP;
    UPDATE "Category" SET "prefix" = prefix_value WHERE "id" = category_row."id";
    category_index := category_index + 1;
  END LOOP;
END $$;

CREATE UNIQUE INDEX "Category_prefix_key" ON "Category"("prefix");
