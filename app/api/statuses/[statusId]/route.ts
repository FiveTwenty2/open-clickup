import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { StatusType } from "@/lib/generated/prisma/client";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { lockWorkflows } from "@/lib/status-workflows";
import { publish } from "@/lib/events";
import { readJson, route, ApiError } from "@/lib/api-helpers";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ statusId: string }> };
const schema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z.string().optional(),
  type: z.enum(["NOT_STARTED", "ACTIVE", "DONE", "CLOSED"]).optional(),
  wipLimit: z.number().int().positive().nullish(),
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const { statusId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true, true);
  const body = await readJson(req, schema);
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.color !== undefined) data.color = body.color;
  if (body.type !== undefined) data.type = body.type as StatusType;
  if (body.wipLimit !== undefined) data.wipLimit = body.wipLimit;
  const status = await prisma.$transaction(async (tx) => {
    await lockWorkflows(tx, workspaceId);
    const current = await tx.status.findFirst({ where: { id: statusId, list: { space: { workspaceId } } }, select: { listId: true } });
    if (!current) throw new ApiError(404, "Status not found");
    await requireResourcePermission("list", current.listId, permissionLevels.EDIT, tx);
    const changed = await tx.status.update({ where: { id: statusId, list: { space: { workspaceId } } }, data });
    if (body.type !== undefined) {
      await tx.$executeRaw`SELECT oc_update_status_tasks(${statusId}, NULL::text)`;
    }
    await tx.list.update({ where: { id: changed.listId }, data: { inheritStatuses: false } });
    return changed;
  });
  publish({ type: "list", listId: status.listId });
  return NextResponse.json(status);
});

export const DELETE = route(async (req, { params }: Ctx) => {
  const { statusId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true, true);
  const { listId, movedTo } = await prisma.$transaction(async (tx) => {
    await lockWorkflows(tx, workspaceId);
    const status = await tx.status.findFirst({ where: { id: statusId, list: { space: { workspaceId } } } });
    if (!status) throw new ApiError(404, "Status not found");
    await requireResourcePermission("list", status.listId, permissionLevels.EDIT, tx);
    await tx.$queryRaw`SELECT id FROM "List" WHERE id = ${status.listId} FOR UPDATE`;
    const fallback = await tx.status.findFirst({
      where: { listId: status.listId, id: { not: statusId } },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    if (!fallback) throw new ApiError(400, "Cannot delete the only status");
    await tx.list.update({ where: { id: status.listId }, data: { inheritStatuses: false } });
    await tx.$executeRaw`SELECT oc_update_status_tasks(${statusId}, ${fallback.id})`;
    return { listId: status.listId, movedTo: fallback.id };
  });
  publish({ type: "list", listId });
  return NextResponse.json({ ok: true, movedTo });
});
