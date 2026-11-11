import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { ApiError, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { id } = await params;
  const { workspaceId } = await requireRole("GUEST");

  const dep = await prisma.taskDependency.findUnique({
    where: { id, blocker: { deletedAt: null, list: { space: { workspaceId } } }, blocked: { deletedAt: null, list: { space: { workspaceId } } } },
    include: { blocker: { select: { listId: true } }, blocked: { select: { listId: true } } },
  });
  if (!dep) throw new ApiError(404, "Dependency not found");
  await requireResourcePermission("task", dep.blockerId, permissionLevels.EDIT);
  await requireResourcePermission("task", dep.blockedId, permissionLevels.EDIT);

  await prisma.taskDependency.delete({ where: { id } });
  for (const listId of new Set([dep.blocker.listId, dep.blocked.listId])) publish({ type: "list", listId });
  return NextResponse.json({ ok: true });
});
