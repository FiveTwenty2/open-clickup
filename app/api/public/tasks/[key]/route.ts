import { NextResponse } from "next/server";
import { setPublicAccess } from "@/lib/access-context";
import { prisma } from "@/lib/db";
import { ApiError, route } from "@/lib/api-helpers";

type Context = { params: Promise<{ key: string }> };
export const GET = route(async (_req, { params }: Context) => {
  const { key } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(key)) throw new ApiError(404, "Link not found");
  setPublicAccess("task", key);
  const shared = await prisma.taskPublicShare.findUnique({
    where: { key, task: { deletedAt: null, archived: false, list: { archivedAt: null } } },
    select: { task: { select: {
      name: true, priority: true, milestone: true, startDate: true, dueDate: true,
      status: { select: { name: true, color: true } },
    } } },
  });
  if (!shared) throw new ApiError(404, "This shared task is unavailable");
  return NextResponse.json(shared.task, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});
