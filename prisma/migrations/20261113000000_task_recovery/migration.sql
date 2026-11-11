ALTER TABLE "Task" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "trashRootId" TEXT;
CREATE INDEX "Task_trashRootId_idx" ON "Task"("trashRootId");
