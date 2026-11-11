ALTER TYPE "ViewType" ADD VALUE 'TIMELINE';
ALTER TYPE "ViewType" ADD VALUE 'TEAM';
ALTER TYPE "ViewType" ADD VALUE 'MIND_MAP';
ALTER TYPE "ViewType" ADD VALUE 'MAP';
ALTER TYPE "ViewType" ADD VALUE 'EMBED';

ALTER TABLE "Task" ADD COLUMN "mapLatitude" DOUBLE PRECISION, ADD COLUMN "mapLongitude" DOUBLE PRECISION;
ALTER TABLE "Task" ADD CONSTRAINT "Task_map_coordinates" CHECK (
  ("mapLatitude" IS NULL AND "mapLongitude" IS NULL) OR
  ("mapLatitude" IS NOT NULL AND "mapLongitude" IS NOT NULL AND "mapLatitude" BETWEEN -90 AND 90 AND "mapLongitude" BETWEEN -180 AND 180)
);

CREATE TABLE "ScopedView" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "spaceId" TEXT REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "folderId" TEXT REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "type" "ViewType" NOT NULL,
  "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "config" JSONB,
  "privateOwnerId" TEXT,
  "protected" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ScopedView_single_location" CHECK ("spaceId" IS NULL OR "folderId" IS NULL)
);
CREATE INDEX "ScopedView_workspaceId_spaceId_folderId_position_idx" ON "ScopedView"("workspaceId", "spaceId", "folderId", "position");
CREATE TABLE "ScopedViewReader" (
  "viewId" TEXT NOT NULL REFERENCES "ScopedView"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  PRIMARY KEY ("viewId", "userId")
);
CREATE TABLE "ScopedViewPublicLink" (
  "viewId" TEXT PRIMARY KEY REFERENCES "ScopedView"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "key" TEXT NOT NULL UNIQUE
);
