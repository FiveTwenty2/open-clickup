import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { userSelect } from "@/lib/queries";
import { route } from "@/lib/api-helpers";

export const GET = route(async (req) => {
  const { workspaceId } = await requireRole("ADMIN");
  const { searchParams } = new URL(req.url);
  const actor = searchParams.get("actor");
  const action = searchParams.get("action");
  const search = searchParams.get("q")?.trim().slice(0, 150);
  const page = Math.max(0, Math.min(10000, Number.parseInt(searchParams.get("page") ?? "", 10) || 0));
  const rows = await prisma.activity.findMany({
    where: {
      task: { list: { space: { workspaceId } }, ...(search && { name: { contains: search, mode: "insensitive" } }) },
      ...(actor && { userId: actor }),
      ...(action === "recovery" && { type: { in: ["archived", "unarchived", "trashed", "restored"] } }),
      ...(action === "discussion" && { type: { in: ["commented", "comment_edited", "comment_deleted", "comment_resolved", "comment_reopened"] } }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: page * 50,
    take: 51,
    include: { user: { select: userSelect }, task: { select: { id: true, name: true, listId: true, deletedAt: true } } },
  });
  return NextResponse.json({ entries: rows.slice(0, 50), hasNext: rows.length > 50 });
});
