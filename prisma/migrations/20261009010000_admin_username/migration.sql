ALTER TABLE "Admin" RENAME COLUMN "email" TO "username";
ALTER INDEX "Admin_email_key" RENAME TO "Admin_username_key";
