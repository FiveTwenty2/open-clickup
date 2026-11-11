import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { route } from "@/lib/api-helpers";
import { requireIntegrationAccess } from "@/lib/integration-access";

export const GET = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req);
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim().slice(0, 150);
  const page = Math.max(0, Math.min(10000, Number.parseInt(params.get("page") ?? "", 10) || 0));
  const lists = await prisma.list.findMany({
    where: { archivedAt: { not: null }, space: { workspaceId }, ...(q && { name: { contains: q, mode: "insensitive" } }) },
    select: { id: true, name: true, archivedAt: true, archivedBy: true, space: { select: { name: true } }, folder: { select: { name: true } } },
    orderBy: [{ archivedAt: "desc" }, { id: "asc" }],
    skip: page * 50, take: 51,
  });
  return NextResponse.json({ lists: lists.slice(0, 50), hasNext: lists.length > 50 });
});
