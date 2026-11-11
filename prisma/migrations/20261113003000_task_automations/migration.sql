CREATE TABLE "TaskAutomation" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "statusId" TEXT,
    "priority" "Priority",
    "dueDays" INTEGER,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAutomation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaskAutomation_listId_enabled_trigger_idx" ON "TaskAutomation"("listId", "enabled", "trigger");
ALTER TABLE "TaskAutomation" ADD CONSTRAINT "TaskAutomation_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
