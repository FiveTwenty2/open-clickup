import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { midpoint } from "@/lib/utils";

type Ctx = { params: Promise<{ listId: string }> };
export const POST = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true);
  const { taskId, targetId, placement } = await readJson(req, z.object({
    taskId: z.string().min(1), targetId: z.string().min(1), placement: z.enum(["before", "after"]),
  }));
  if (taskId === targetId) throw new ApiError(400, "Choose a different task");
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM "List" l JOIN "Space" s ON s.id = l."spaceId"
      WHERE l.id = ${listId} AND l."archivedAt" IS NULL AND s."workspaceId" = ${workspaceId}
      FOR UPDATE OF l
    `;
    if (!locked.length) throw new ApiError(404, "Active list not found");
    const rows = await tx.task.findMany({
      where: { listId, parentId: null, archived: false, deletedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, position: true },
    });
    const task = rows.find((row) => row.id === taskId);
    const ordered = rows.filter((row) => row.id !== taskId);
    const target = ordered.findIndex((row) => row.id === targetId);
    if (!task || target < 0) throw new ApiError(409, "One of these tasks moved or is no longer available");
    const index = target + Number(placement === "after");
    const previous = ordered[index - 1]?.position ?? null;
    const next = ordered[index]?.position ?? null;
    const position = midpoint(previous, next);
    if (Number.isFinite(position) && (previous === null || position > previous) && (next === null || position < next)) {
      await tx.task.update({ where: { id: taskId, listId, archived: false, deletedAt: null }, data: { position } });
    } else {
      ordered.splice(index, 0, task);
      // Re-space equal ranks and ranks that ran out of floating-point precision.
      for (let offset = 0; offset < ordered.length; offset += 1000) {
        const values = ordered.slice(offset, offset + 1000).map((row, i) => Prisma.sql`(${row.id}, ${(offset + i + 1) * 1000}::double precision)`);
        await tx.$executeRaw`
          UPDATE "Task" t SET position = r.position FROM (VALUES ${Prisma.join(values)}) AS r(id, position)
          WHERE t.id = r.id AND t."listId" = ${listId} AND t."deletedAt" IS NULL AND NOT t.archived
        `;
      }
    }
  });
  publish({ type: "list", listId });
  return NextResponse.json({ ok: true });
});
