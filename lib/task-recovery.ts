import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { publish } from "@/lib/events";

export async function trashTasks(workspaceId: string, ids: string[]) {
  const moved = await prisma.$transaction(async (tx) => {
    const roots = await tx.task.findMany({
      where: { id: { in: ids }, deletedAt: null, list: { space: { workspaceId } } },
      select: { id: true, listId: true },
    });
    if (roots.length !== new Set(ids).size) throw new ApiError(404, "Some tasks are no longer available");
    const now = new Date();
    for (const root of roots) {
      // A previously trashed descendant retains its own recovery group.
      await tx.$executeRaw`
        WITH RECURSIVE branch(id) AS (
          SELECT id FROM "Task" WHERE id = ${root.id} AND "deletedAt" IS NULL
          UNION
          SELECT child.id FROM "Task" child JOIN branch parent ON child."parentId" = parent.id
          WHERE child."listId" = ${root.listId} AND child."deletedAt" IS NULL
        )
        UPDATE "Task" SET "deletedAt" = ${now}, "trashRootId" = ${root.id}, "updatedAt" = ${now}
        WHERE id IN (SELECT id FROM branch) AND "deletedAt" IS NULL
      `;
    }
    return roots;
  });
  for (const listId of new Set(moved.map((task) => task.listId))) publish({ type: "list", listId });
  return moved.length;
}

export async function restoreTask(workspaceId: string, id: string) {
  const listId = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id, list: { space: { workspaceId } } },
      select: { archived: true, deletedAt: true, listId: true, trashRootId: true, parent: { select: { deletedAt: true } } },
    });
    if (!task) throw new ApiError(404, "Task not found");
    if (task.parent?.deletedAt) throw new ApiError(409, "Restore the parent task first");
    if (task.deletedAt) {
      if (task.trashRootId !== id) throw new ApiError(409, "Restore the task group from Trash");
      await tx.task.updateMany({
        where: { trashRootId: id, listId: task.listId },
        data: { deletedAt: null, trashRootId: null },
      });
    } else if (task.archived) {
      await tx.task.update({ where: { id }, data: { archived: false } });
    }
    return task.listId;
  });
  publish({ type: "list", listId });
}

export async function getRecoveryTasks(workspaceId: string, mode: "archive" | "trash", page: number) {
  const entries = await prisma.task.findMany({
    where: {
      list: { space: { workspaceId } },
      ...(mode === "archive"
        ? { deletedAt: null, archived: true }
        : { deletedAt: { not: null }, trashRootId: { not: null }, OR: [{ parentId: null }, { parent: { deletedAt: null } }] }),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: page * 50,
    take: 51,
    select: {
      id: true, name: true, listId: true, deletedAt: true, updatedAt: true,
      list: { select: { name: true, space: { select: { name: true } } } },
      status: { select: { name: true, color: true } },
    },
  });
  return { tasks: entries.slice(0, 50), hasNext: entries.length > 50 };
}
