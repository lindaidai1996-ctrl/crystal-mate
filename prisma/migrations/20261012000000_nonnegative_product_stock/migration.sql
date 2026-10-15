ALTER TABLE "Product" DROP CONSTRAINT "Product_stock_check";
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_check" CHECK ("stock" >= 0);
