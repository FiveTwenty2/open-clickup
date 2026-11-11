import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { ApiError, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { id } = await params;
  const { user, role, workspaceId } = await requireRole("MEMBER");

  const entry = await prisma.timeEntry.findUnique({
    where: { id, task: { deletedAt: null, list: { space: { workspaceId } } } },
    include: { task: { select: { listId: true } } },
  });
  if (!entry) throw new ApiError(404, "Time entry not found");
  if (role === "MEMBER" && entry.userId !== user.id) throw new ApiError(403, "You can only remove your own time entries");

  await prisma.timeEntry.delete({ where: { id } });
  publish({ type: "list", listId: entry.task.listId });
  return NextResponse.json({ ok: true });
});
