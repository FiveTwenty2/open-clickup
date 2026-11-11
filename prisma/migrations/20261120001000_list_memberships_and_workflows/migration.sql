ALTER TABLE "Space" ADD COLUMN "statusWorkflow" JSONB;
ALTER TABLE "Folder" ADD COLUMN "statusWorkflow" JSONB;
ALTER TABLE "List" ADD COLUMN "inheritStatuses" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Status" ADD COLUMN "inheritedKey" TEXT;
CREATE TABLE "TaskListMembership" (
  "taskId" TEXT NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "listId" TEXT NOT NULL REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("taskId", "listId")
);
CREATE INDEX "TaskListMembership_listId_taskId_idx" ON "TaskListMembership"("listId", "taskId");
