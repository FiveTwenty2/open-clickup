import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { route } from "@/lib/api-helpers";

export const GET = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req);
  const listId = new URL(req.url).searchParams.get("list");
  const tasks = await prisma.task.findMany({
    where: { archived: false, deletedAt: null, list: { archivedAt: null, space: { workspaceId } }, ...(listId && { listId }) },
    select: {
      id: true, name: true, listId: true, parentId: true, priority: true, archived: true, milestone: true, startDate: true, dueDate: true,
      status: { select: { id: true, name: true, color: true, type: true } },
      assignees: { select: { userId: true } },
    },
    orderBy: [{ dueDate: "asc" }, { startDate: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ tasks });
});
