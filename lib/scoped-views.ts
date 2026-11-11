import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { taskInclude } from "@/lib/queries";
import type { Prisma } from "@/lib/generated/prisma/client";
import { visibleSecondaryTaskIdsForLists } from "@/lib/task-placements";

export type ViewScope = { workspaceId: string; spaceId: string | null; folderId: string | null };

export function locationUrl(scope: { spaceId?: string | null; folderId?: string | null }) {
  if (scope.folderId) return `/views/folder/${scope.folderId}`;
  if (scope.spaceId) return `/views/space/${scope.spaceId}`;
  return "/views/workspace";
}

export async function getViewScope(workspaceId: string, spaceId: string | null, folderId: string | null) {
  if (spaceId && folderId) throw new ApiError(400, "Choose one location");
  const scope: ViewScope = { workspaceId, spaceId, folderId };
  if (spaceId) {
    const space = await prisma.space.findFirst({ where: { id: spaceId, workspaceId }, select: { name: true } });
    if (!space) throw new ApiError(404, "Space not found");
    return { scope, name: space.name };
  }
  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, space: { workspaceId } }, select: { name: true },
    });
    if (!folder) throw new ApiError(404, "Folder not found");
    return { scope, name: folder.name };
  }
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
  if (!workspace) throw new ApiError(404, "Workspace not found");
  return { scope, name: workspace.name };
}

export async function scopedListWhere(scope: ViewScope, publicView = false) {
  // The capability policy validates public scope directly. A public folder link does not grant access to its ancestor Space row.
  const workspace = publicView ? {} : { space: { workspaceId: scope.workspaceId } };
  const where: Prisma.ListWhereInput = { archivedAt: null, ...workspace };
  if (scope.spaceId) where.spaceId = scope.spaceId;
  if (scope.folderId) {
    const folders = await prisma.folder.findMany({
      where: workspace, select: { id: true, parentId: true },
    });
    const children = new Map<string, string[]>();
    for (const folder of folders) {
      if (!folder.parentId) continue;
      const siblings = children.get(folder.parentId) ?? [];
      siblings.push(folder.id);
      children.set(folder.parentId, siblings);
    }
    const ids = new Set([scope.folderId]);
    const queue = [scope.folderId];
    for (let i = 0; i < queue.length; i++) {
      for (const id of children.get(queue[i]) ?? []) {
        if (ids.has(id)) continue;
        ids.add(id);
        queue.push(id);
      }
    }
    where.folderId = { in: [...ids] };
  }
  return where;
}

export async function getScopedViewTasks(scope: ViewScope) {
  const destination = await scopedListWhere(scope);
  const lists = await prisma.list.findMany({ where: destination, select: { id: true } });
  const secondaryIds = await visibleSecondaryTaskIdsForLists(prisma, lists.map(({ id }) => id));
  return prisma.task.findMany({
    where: {
      deletedAt: null, archived: false, list: { archivedAt: null, space: { workspaceId: scope.workspaceId } },
      OR: [{ list: destination }, { id: { in: secondaryIds } }],
    },
    orderBy: [{ listId: "asc" }, { position: "asc" }, { id: "asc" }],
    include: { ...taskInclude, list: { select: { name: true, statuses: { orderBy: { position: "asc" } } } } },
  });
}

export async function getPublicScopedViewTasks(scope: ViewScope) {
  const destination = await scopedListWhere(scope, true);
  const lists = await prisma.list.findMany({ where: destination, select: { id: true } });
  const secondaryIds = await visibleSecondaryTaskIdsForLists(prisma, lists.map(({ id }) => id), { publicView: true });
  return prisma.task.findMany({
    where: { deletedAt: null, archived: false, OR: [{ list: destination }, { id: { in: secondaryIds } }] },
    orderBy: [{ position: "asc" }, { id: "asc" }], include: taskInclude,
  });
}

export function getViewDependencies(taskIds: string[]) {
  if (!taskIds.length) return Promise.resolve([]);
  return prisma.taskDependency.findMany({
    where: { blockerId: { in: taskIds }, blockedId: { in: taskIds } },
    select: { id: true, blockerId: true, blockedId: true },
  });
}
