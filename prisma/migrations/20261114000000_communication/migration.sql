ALTER TABLE "Notification" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "commentId" TEXT;
CREATE TABLE "CommentFile" (
  "id" TEXT PRIMARY KEY,
  "commentId" TEXT NOT NULL REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "contents" BYTEA NOT NULL
);
CREATE INDEX "CommentFile_commentId_idx" ON "CommentFile"("commentId");
CREATE TABLE "DirectMessage" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recipientId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DirectMessage_workspaceId_senderId_recipientId_createdAt_idx"
  ON "DirectMessage"("workspaceId", "senderId", "recipientId", "createdAt");
