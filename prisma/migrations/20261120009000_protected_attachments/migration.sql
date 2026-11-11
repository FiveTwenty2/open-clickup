CREATE TABLE "AttachmentBlob" (
  "attachmentId" TEXT PRIMARY KEY REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "contents" BYTEA NOT NULL
);
