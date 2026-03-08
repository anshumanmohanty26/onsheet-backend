-- CreateTable
CREATE TABLE "cell_comments" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "cell_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cell_comments_sheetId_idx" ON "cell_comments"("sheetId");

-- AddForeignKey
ALTER TABLE "cell_comments" ADD CONSTRAINT "cell_comments_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_comments" ADD CONSTRAINT "cell_comments_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
