import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess, requireTaskInWorkspace } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";
import { visibleSecondaryListIds, visibleSecondaryTaskIds } from "@/lib/task-placements";

type Context = { params: Promise<{ taskId: string }> };
const input = z.object({ listId: z.string().min(1) });

export const GET = route(async (req, { params }: Context) => {
  const { taskId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req);
  await requireTaskInWorkspace(taskId, workspaceId);
  const memberships = await prisma.taskListMembership.findMany({
    where: { taskId, explicit: true, list: { space: { workspaceId } } },
    select: { list: { select: { id: true, name: true, archivedAt: true } } },
    orderBy: [{ createdAt: "asc" }, { listId: "asc" }],
  });
  const explicit = memberships.map(({ list }) => ({ ...list, inherited: false }));
  const directIds = new Set(explicit.map(({ id }) => id));
  const inheritedIds = (await visibleSecondaryListIds(prisma, taskId)).filter((id) => !directIds.has(id));
  const inherited = inheritedIds.length ? await prisma.list.findMany({
    where: { id: { in: inheritedIds }, space: { workspaceId } },
    select: { id: true, name: true, archivedAt: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  }) : [];
  return NextResponse.json([...explicit, ...inherited.map((list) => ({ ...list, inherited: true }))]);
});

async function change(req: Request, { params }: Context, add: boolean) {
  const { taskId } = await params;
  const { workspaceId, user } = await requireIntegrationAccess(req, true, true);
  const { listId } = await readJson(req, input);
  const home = await requireTaskInWorkspace(taskId, workspaceId);
  const destination = await prisma.list.findFirst({
    where: { id: listId, space: { workspaceId }, ...(add && { archivedAt: null }) }, select: { name: true },
  });
  if (!destination) throw new ApiError(404, "List not found");
  if (home.listId === listId) throw new ApiError(400, "This is the task's home list");
  await prisma.$transaction(async (tx) => {
    await requireResourcePermission("list", listId, permissionLevels.EDIT, tx);
    await requireResourcePermission("task", taskId, permissionLevels.EDIT, tx);
    await tx.$queryRaw`SELECT id FROM "List" WHERE id = ${listId} FOR NO KEY UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
    const current = await tx.task.findFirst({
      where: { id: taskId, deletedAt: null }, select: { listId: true, archived: true, position: true },
    });
    if (!current) throw new ApiError(404, "Task not found");
    if (current.listId === listId) throw new ApiError(400, "This is the task's home list");
    if (add && current.archived) throw new ApiError(400, "Restore the task before adding it to a list");
    let changed;
    if (add) {
      const where = { taskId_listId: { taskId, listId } };
      const membership = await tx.taskListMembership.findUnique({ where, select: { explicit: true } });
      if (membership?.explicit) return;
      const alreadyPlaced = (await visibleSecondaryListIds(tx, taskId)).includes(listId);
      let position = current.position;
      if (!alreadyPlaced) {
        const homeRanks = await tx.task.aggregate({ where: { listId, deletedAt: null }, _max: { position: true } });
        const placementRanks = await tx.taskListMembership.aggregate({ where: { listId }, _max: { position: true } });
        position = Math.max(homeRanks._max.position ?? 0, placementRanks._max.position ?? 0) + 1000;
      }
      await tx.taskListMembership.upsert({
        where, create: { taskId, listId, position }, update: { explicit: true },
      });
      changed = { count: 1 };
    } else {
      const member = await tx.taskListMembership.findUnique({
        where: { taskId_listId: { taskId, listId } }, select: { explicit: true },
      });
      if (!member?.explicit) return;
      const before = await visibleSecondaryTaskIds(tx, listId);
      const after = new Set(await visibleSecondaryTaskIds(tx, listId, taskId));
      const removed = [...new Set([taskId, ...before])].filter((id) => !after.has(id));
      await tx.customFieldValue.deleteMany({ where: { taskId: { in: removed }, field: { listId } } });
      await tx.taskListMembership.deleteMany({ where: { taskId: { in: removed }, listId, explicit: false } });
      changed = after.has(taskId)
        ? await tx.taskListMembership.updateMany({ where: { taskId, listId, explicit: true }, data: { explicit: false } })
        : await tx.taskListMembership.deleteMany({ where: { taskId, listId, explicit: true } });
    }
    if (changed.count) await tx.activity.create({
      data: { taskId, userId: user.id, type: add ? "added_to_list" : "removed_from_list", data: {} },
    });
  });
  publish({ type: "list", listId: home.listId });
  publish({ type: "list", listId });
  return NextResponse.json({ ok: true });
}

export const POST = route((req, context: Context) => change(req, context, true));
export const DELETE = route((req, context: Context) => change(req, context, false));
