ALTER TABLE "Folder" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");
