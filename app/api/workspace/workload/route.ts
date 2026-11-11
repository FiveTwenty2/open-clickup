import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { ApiError, route } from "@/lib/api-helpers";

export const GET = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req);
  const params = new URL(req.url).searchParams;
  const from = new Date(params.get("from") ?? "");
  const to = new Date(params.get("to") ?? "");
  const span = +to - +from;
  if (!Number.isFinite(span) || span <= 0 || span > 8 * 86400000) throw new ApiError(400, "Choose a period of up to eight days");
  const listId = params.get("listId");
  const tasks = await prisma.task.findMany({
    where: {
      list: { archivedAt: null, space: { workspaceId } },
      ...(listId && { listId }),
      archived: false, deletedAt: null, status: { type: { in: ["NOT_STARTED", "ACTIVE"] } },
      OR: [
        { dueDate: { gte: from, lt: to } },
        { dueDate: null, startDate: { gte: from, lt: to } },
        { startDate: { lt: to }, dueDate: { gte: from } },
      ],
    },
    select: {
      id: true, name: true, listId: true, timeEstimate: true, startDate: true, dueDate: true,
      list: { select: { name: true } },
      assignees: { select: { userId: true } },
    },
    orderBy: [{ dueDate: "asc" }, { startDate: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ tasks });
});
