-- CreateTable
CREATE TABLE "sheet_snapshots" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Autosave',
    "cells" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "sheet_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sheet_snapshots_sheetId_createdAt_idx" ON "sheet_snapshots"("sheetId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "sheet_snapshots" ADD CONSTRAINT "sheet_snapshots_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_snapshots" ADD CONSTRAINT "sheet_snapshots_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
