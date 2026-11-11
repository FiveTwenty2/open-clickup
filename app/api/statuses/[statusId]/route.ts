import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { StatusType } from "@/lib/generated/prisma/client";
import { requireRole } from "@/lib/permissions";
import { publish } from "@/lib/events";
import { isCompletedStatus } from "@/lib/task-status";
import { readJson, route, ApiError } from "@/lib/api-helpers";

type Ctx = { params: Promise<{ statusId: string }> };
const schema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z.string().optional(),
  type: z.enum(["NOT_STARTED", "ACTIVE", "DONE", "CLOSED"]).optional(),
  wipLimit: z.number().int().positive().nullish(),
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const { statusId } = await params;
  const { workspaceId } = await requireRole("MEMBER");
  const body = await readJson(req, schema);
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.color !== undefined) data.color = body.color;
  if (body.type !== undefined) data.type = body.type as StatusType;
  if (body.wipLimit !== undefined) data.wipLimit = body.wipLimit;
  const status = await prisma.$transaction(async (tx) => {
    const changed = await tx.status.update({ where: { id: statusId, list: { space: { workspaceId } } }, data });
    if (body.type !== undefined) {
      const completed = isCompletedStatus(body.type);
      await tx.task.updateMany({
        where: { statusId, completedAt: completed ? null : { not: null } },
        data: { completedAt: completed ? new Date() : null },
      });
    }
    return changed;
  });
  publish({ type: "list", listId: status.listId });
  return NextResponse.json(status);
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { statusId } = await params;
  const { workspaceId } = await requireRole("MEMBER");
  const { listId, movedTo } = await prisma.$transaction(async (tx) => {
    const status = await tx.status.findFirst({ where: { id: statusId, list: { space: { workspaceId } } } });
    if (!status) throw new ApiError(404, "Status not found");
    await tx.$queryRaw`SELECT id FROM "List" WHERE id = ${status.listId} FOR UPDATE`;
    const fallback = await tx.status.findFirst({
      where: { listId: status.listId, id: { not: statusId } },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    if (!fallback) throw new ApiError(400, "Cannot delete the only status");
    const completed = isCompletedStatus(fallback.type);
    if (completed) await tx.task.updateMany({ where: { statusId, completedAt: null }, data: { completedAt: new Date() } });
    await tx.task.updateMany({ where: { statusId }, data: { statusId: fallback.id, ...(!completed && { completedAt: null }) } });
    await tx.status.delete({ where: { id: statusId } });
    return { listId: status.listId, movedTo: fallback.id };
  });
  publish({ type: "list", listId });
  return NextResponse.json({ ok: true, movedTo });
});
