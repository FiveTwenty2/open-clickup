import { NextResponse } from "next/server";
import { z } from "zod";
import { getListData } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess, requireListInWorkspace } from "@/lib/integration-access";
import { requireRole } from "@/lib/permissions";
import { publish } from "@/lib/events";
import { readJson, route, ApiError } from "@/lib/api-helpers";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ listId: string }> };
const schema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z.string().nullish(),
  archived: z.boolean().optional(),
});

export const GET = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId, user } = await requireIntegrationAccess(req);
  await requireListInWorkspace(listId, workspaceId);
  const data = await getListData(listId, user.id);
  if (!data) throw new ApiError(404, "List not found");
  return NextResponse.json(data);
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { user, workspaceId } = await requireIntegrationAccess(req, true, true);
  const { archived, ...fields } = await readJson(req, schema);
  const list = await prisma.$transaction(async (tx) => {
    await requireResourcePermission("list", listId, permissionLevels.EDIT, tx);
    const current = await tx.list.findFirst({
      where: { id: listId, space: { workspaceId } }, select: { archivedAt: true },
    });
    if (!current) throw new ApiError(404, "List not found");
    const changes = archived !== undefined && archived !== Boolean(current.archivedAt)
      ? { archivedAt: archived ? new Date() : null, archivedBy: archived ? user.name : null } : {};
    return tx.list.update({ where: { id: listId, space: { workspaceId } }, data: { ...fields, ...changes } });
  });
  publish({ type: "bootstrap" });
  publish({ type: "list", listId });
  return NextResponse.json(list);
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireRole("GUEST");
  await requireResourcePermission("list", listId, permissionLevels.FULL);
  await prisma.list.delete({ where: { id: listId, space: { workspaceId } } });
  publish({ type: "bootstrap" });
  return NextResponse.json({ ok: true });
});
