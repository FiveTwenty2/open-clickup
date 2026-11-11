CREATE TABLE "WorkspaceTaskType" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL
);
CREATE UNIQUE INDEX "WorkspaceTaskType_workspaceId_name_key" ON "WorkspaceTaskType"("workspaceId", "name");
ALTER TABLE "Task" ADD COLUMN "taskTypeId" TEXT REFERENCES "WorkspaceTaskType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_taskTypeId_idx" ON "Task"("taskTypeId");
