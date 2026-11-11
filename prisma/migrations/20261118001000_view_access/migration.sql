ALTER TABLE "View" ADD COLUMN "privateOwnerId" TEXT, ADD COLUMN "protected" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "View_listId_privateOwnerId_idx" ON "View"("listId", "privateOwnerId");
