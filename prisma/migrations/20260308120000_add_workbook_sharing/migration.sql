-- AlterTable: add shareToken and publicAccess to workbooks
ALTER TABLE "workbooks" ADD COLUMN "shareToken" TEXT;
ALTER TABLE "workbooks" ADD COLUMN "publicAccess" BOOLEAN NOT NULL DEFAULT false;

-- Backfill shareToken for existing rows (generate unique value per row)
UPDATE "workbooks" SET "shareToken" = gen_random_uuid()::text WHERE "shareToken" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "workbooks_shareToken_key" ON "workbooks"("shareToken");
