import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { requireTaskInWorkspace, requireListInWorkspace } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { isCompletedStatus } from "@/lib/task-status";

type Ctx = { params: Promise<{ taskId: string }> };
const schema = z.object({ listId: z.string().min(1) });

export const POST = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { user, workspaceId } = await requireRole("MEMBER");
  const { listId: targetListId } = await readJson(req, schema);
  const source = await requireTaskInWorkspace(taskId, workspaceId);
  await requireListInWorkspace(targetListId, workspaceId);
  if (source.listId === targetListId) return NextResponse.json({ ok: true, listId: targetListId });

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId, deletedAt: null }, select: { parentId: true, listId: true } });
    if (!task || task.listId !== source.listId) throw new ApiError(409, "This task changed lists. Try again.");
    if (task.parentId) throw new ApiError(400, "Move the parent task instead of a subtask");
    const target = await tx.list.findUniqueOrThrow({ where: { id: targetListId }, include: { statuses: { orderBy: { position: "asc" } } } });
    if (!target.statuses.length) throw new ApiError(400, "Target list has no statuses");
    const last = await tx.task.aggregate({ where: { listId: targetListId, parentId: null }, _max: { position: true } });
    const branch = await tx.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE branch(id) AS (
        SELECT id FROM "Task" WHERE id = ${taskId}
        UNION
        SELECT child.id FROM "Task" child JOIN branch parent ON child."parentId" = parent.id
        WHERE child."listId" = ${source.listId}
      ) SELECT id FROM branch
    `;
    const ids = branch.map((entry) => entry.id);
    const members = await tx.task.findMany({
      where: { id: { in: ids } }, select: { id: true, status: { select: { name: true, type: true } }, completedAt: true },
    });
    const byStatus = new Map<string, { open: boolean; ids: string[] }>();
    for (const entry of members) {
      const status = target.statuses.find((candidate) => candidate.name.toLowerCase() === entry.status.name.toLowerCase())
        ?? target.statuses.find((candidate) => candidate.type === entry.status.type)
        ?? target.statuses.find((candidate) => isCompletedStatus(candidate.type) === isCompletedStatus(entry.status.type))
        ?? target.statuses[0];
      const group = byStatus.get(status.id) ?? { open: !isCompletedStatus(status.type), ids: [] };
      group.ids.push(entry.id);
      byStatus.set(status.id, group);
    }
    await tx.customFieldValue.deleteMany({ where: { taskId: { in: ids } } });
    await tx.taskTag.deleteMany({ where: { taskId: { in: ids }, tag: { spaceId: { not: target.spaceId } } } });
    for (const [statusId, group] of byStatus) {
      await tx.task.updateMany({
        where: { id: { in: group.ids } },
        data: { listId: targetListId, statusId, ...(group.open && { completedAt: null }) },
      });
      if (!group.open) await tx.task.updateMany({
        where: { id: { in: group.ids }, completedAt: null }, data: { completedAt: new Date() },
      });
    }
    await tx.task.update({ where: { id: taskId }, data: { position: (last._max.position ?? 0) + 1000 } });
    await tx.activity.create({ data: { taskId, userId: user.id, type: "moved", data: { toList: target.name } } });
  });

  publish({ type: "list", listId: source.listId });
  publish({ type: "list", listId: targetListId });
  publish({ type: "bootstrap" });
  return NextResponse.json({ ok: true, listId: targetListId });
});
