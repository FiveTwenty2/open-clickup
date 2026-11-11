import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { permissionLevels, requireTaskBranchPermission } from "@/lib/resource-permissions";

export async function trashTasks(workspaceId: string, ids: string[], actorId: string) {
  const moved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    const roots = await tx.task.findMany({
      where: { id: { in: ids }, deletedAt: null, list: { space: { workspaceId } } },
      select: { id: true, listId: true },
    });
    if (roots.length !== new Set(ids).size) throw new ApiError(404, "Some tasks are no longer available");
    const now = new Date();
    for (const root of roots) {
      await requireTaskBranchPermission(root.id, permissionLevels.FULL, tx);
      // A previously trashed descendant retains its own recovery group.
      const changed = await tx.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE branch(id) AS (
          SELECT id FROM "Task" WHERE id = ${root.id} AND "deletedAt" IS NULL
          UNION
          SELECT child.id FROM "Task" child JOIN branch parent ON child."parentId" = parent.id
          WHERE child."listId" = ${root.listId} AND child."deletedAt" IS NULL
        )
        UPDATE "Task" SET "deletedAt" = ${now}, "trashRootId" = ${root.id}, "updatedAt" = ${now}
        WHERE id IN (SELECT id FROM branch) AND "deletedAt" IS NULL
        RETURNING id
      `;
      if (changed.length) await tx.activity.createMany({
        data: changed.map(({ id }) => ({ taskId: id, userId: actorId, type: "trashed", data: { rootId: root.id } })),
      });
    }
    return roots;
  });
  for (const listId of new Set(moved.map((task) => task.listId))) publish({ type: "list", listId });
  return moved.length;
}

export async function restoreTask(workspaceId: string, id: string, actorId: string) {
  const listId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    const task = await tx.task.findFirst({
      where: { id, list: { space: { workspaceId } } },
      select: { archived: true, deletedAt: true, listId: true, trashRootId: true, parent: { select: { deletedAt: true } } },
    });
    if (!task) throw new ApiError(404, "Task not found");
    await requireTaskBranchPermission(id, permissionLevels.FULL, tx);
    if (task.parent?.deletedAt) throw new ApiError(409, "Restore the parent task first");
    if (task.deletedAt) {
      if (task.trashRootId !== id) throw new ApiError(409, "Restore the task group from Trash");
      const restored = await tx.task.updateManyAndReturn({
        where: { trashRootId: id, listId: task.listId },
        data: { deletedAt: null, trashRootId: null }, select: { id: true },
      });
      if (restored.length) await tx.activity.createMany({
        data: restored.map((row) => ({ taskId: row.id, userId: actorId, type: "restored", data: { rootId: id } })),
      });
    } else if (task.archived) {
      const changed = await tx.task.updateMany({ where: { id, archived: true, deletedAt: null }, data: { archived: false } });
      if (changed.count) await tx.activity.create({ data: { taskId: id, userId: actorId, type: "unarchived" } });
    }
    return task.listId;
  });
  publish({ type: "list", listId });
}

export async function getRecoveryTasks(workspaceId: string, mode: "archive" | "trash", page: number, search?: string) {
  const entries = await prisma.task.findMany({
    where: {
      list: { space: { workspaceId } },
      ...(search && { name: { contains: search, mode: "insensitive" } }),
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
      activities: {
        where: { type: mode === "archive" ? "archived" : "trashed" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { createdAt: true, user: { select: { name: true } } },
      },
    },
  });
  return { tasks: entries.slice(0, 50), hasNext: entries.length > 50 };
}
