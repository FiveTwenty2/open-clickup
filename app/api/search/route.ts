import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { route } from "@/lib/api-helpers";
import { requireIntegrationAccess } from "@/lib/integration-access";

export const GET = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req);
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 200) ?? "";
  if (!q) return NextResponse.json({ tasks: [], lists: [] });

  const [tasks, lists] = await Promise.all([
    prisma.task.findMany({
      where: { name: { contains: q, mode: "insensitive" }, archived: false, deletedAt: null, list: { space: { workspaceId } } },
      take: 12,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        listId: true,
        status: { select: { name: true, color: true, type: true } },
        list: { select: { name: true } },
      },
    }),
    prisma.list.findMany({
      where: { name: { contains: q, mode: "insensitive" }, space: { workspaceId } },
      take: 6,
      select: {
        id: true,
        name: true,
        color: true,
        space: { select: { name: true } },
      },
    }),
  ]);

  return NextResponse.json({ tasks, lists });
});
