import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { midpoint } from "@/lib/utils";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";
import { visibleSecondaryTaskIds } from "@/lib/task-placements";

type Ctx = { params: Promise<{ listId: string }> };
export const POST = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true, true);
  const { taskId, targetId, placement } = await readJson(req, z.object({
    taskId: z.string().min(1), targetId: z.string().min(1), placement: z.enum(["before", "after"]),
  }));
  if (taskId === targetId) throw new ApiError(400, "Choose a different task");
  await prisma.$transaction(async (tx) => {
    await requireResourcePermission("list", listId, permissionLevels.EDIT, tx);
    await requireResourcePermission("task", taskId, permissionLevels.EDIT, tx);
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM "List" l JOIN "Space" s ON s.id = l."spaceId"
      WHERE l.id = ${listId} AND l."archivedAt" IS NULL AND s."workspaceId" = ${workspaceId}
      FOR NO KEY UPDATE OF l
    `;
    if (!locked.length) throw new ApiError(404, "Active list not found");
    const secondaryIds = await visibleSecondaryTaskIds(tx, listId);
    const rows = await tx.task.findMany({
      where: {
        archived: false, deletedAt: null,
        OR: [{ listId }, { id: { in: secondaryIds } }],
      },
      select: {
        id: true, listId: true, parentId: true, position: true,
        listMemberships: { where: { listId }, select: { position: true } },
      },
    });
    const visibleIds = new Set(rows.map((row) => row.id));
    const placements = rows.map((row) => ({
      id: row.id,
      home: row.listId === listId,
      parentId: row.listId === listId || (row.parentId && visibleIds.has(row.parentId)) ? row.parentId : null,
      position: row.listMemberships[0]?.position ?? row.position,
      hasRank: row.listMemberships.length > 0,
    }));
    const task = placements.find((row) => row.id === taskId);
    if (!task) throw new ApiError(409, "The task moved or is no longer available");
    const ordered = placements.filter((row) => row.id !== taskId && row.parentId === task.parentId)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const target = ordered.findIndex((row) => row.id === targetId);
    if (target < 0) throw new ApiError(409, "Tasks can only be reordered among siblings");
    const index = target + Number(placement === "after");
    const previous = ordered[index - 1]?.position ?? null;
    const next = ordered[index]?.position ?? null;
    const position = midpoint(previous, next);
    if (Number.isFinite(position) && (previous === null || position > previous) && (next === null || position < next)) {
      if (task.home) {
        await tx.task.update({ where: { id: taskId, listId, archived: false, deletedAt: null }, data: { position } });
      } else {
        await tx.taskListMembership.upsert({
          where: { taskId_listId: { taskId, listId } },
          create: { taskId, listId, position, explicit: false },
          update: { position },
        });
      }
    } else {
      ordered.splice(index, 0, task);
      // Re-space equal ranks and ranks that ran out of floating-point precision.
      for (let offset = 0; offset < ordered.length; offset += 1000) {
        const ranks = ordered.slice(offset, offset + 1000).map((row, i) => ({
          ...row, position: (offset + i + 1) * 1000,
        }));
        const asSql = (rank: typeof ranks[number]) => Prisma.sql`(${rank.id}, ${rank.position}::double precision)`;
        const homeRanks = ranks.filter((rank) => rank.home).map(asSql);
        const placementRanks = ranks.filter((rank) => !rank.home && rank.hasRank).map(asSql);
        const implicitRanks = ranks.filter((rank) => !rank.home && !rank.hasRank);
        if (implicitRanks.length) await tx.taskListMembership.createMany({
          data: implicitRanks.map(({ id, position }) => ({ taskId: id, listId, position, explicit: false })),
        });
        if (homeRanks.length) await tx.$executeRaw`
          UPDATE "Task" t SET position = r.position FROM (VALUES ${Prisma.join(homeRanks)}) AS r(id, position)
          WHERE t.id = r.id AND t."listId" = ${listId} AND t."deletedAt" IS NULL AND NOT t.archived AND t."parentId" IS NOT DISTINCT FROM ${task.parentId}::text
        `;
        if (placementRanks.length) await tx.$executeRaw`
          UPDATE "TaskListMembership" m SET position = r.position FROM (VALUES ${Prisma.join(placementRanks)}) AS r(id, position)
          WHERE m."taskId" = r.id AND m."listId" = ${listId}
        `;
      }
    }
  });
  publish({ type: "list", listId });
  return NextResponse.json({ ok: true });
});
