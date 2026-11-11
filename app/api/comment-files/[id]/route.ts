import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { ApiError, route } from "@/lib/api-helpers";

type Ctx = { params: Promise<{ id: string }> };
export const GET = route(async (_req, { params }: Ctx) => {
  const { workspaceId } = await requireRole("GUEST");
  const { id } = await params;
  const file = await prisma.commentFile.findFirst({
    where: { id, comment: { task: { deletedAt: null, list: { space: { workspaceId } } } } },
    select: { name: true, contents: true },
  });
  if (!file) throw new ApiError(404, "File not found");
  const filename = encodeURIComponent(Buffer.from(file.name).toString("utf8")).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16));
  return new NextResponse(new Uint8Array(file.contents), { headers: {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": "attachment; filename*=UTF-8''" + filename,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
});
