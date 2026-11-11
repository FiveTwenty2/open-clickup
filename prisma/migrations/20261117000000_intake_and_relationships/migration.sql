CREATE TABLE "IntakeForm" (
  "id" TEXT PRIMARY KEY,
  "listId" TEXT NOT NULL REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "shareKey" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "questions" JSONB NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "IntakeForm_listId_idx" ON "IntakeForm"("listId");

CREATE TABLE "TaskRelationship" (
  "id" TEXT PRIMARY KEY,
  "leftId" TEXT NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "rightId" TEXT NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskRelationship_order" CHECK ("leftId" <> "rightId")
);
CREATE UNIQUE INDEX "TaskRelationship_leftId_rightId_key" ON "TaskRelationship"("leftId", "rightId");
CREATE INDEX "TaskRelationship_rightId_idx" ON "TaskRelationship"("rightId");

CREATE TABLE "TaskResourceLink" (
  "id" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL
);
CREATE UNIQUE INDEX "TaskResourceLink_taskId_url_key" ON "TaskResourceLink"("taskId", "url");
