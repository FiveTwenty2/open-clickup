import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

const schema = z.object({
  spaceId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1, "name is required"),
});

export const POST = route(async (req) => {
  const { workspaceId } = await requireRole("GUEST");
  const { spaceId, name, parentId = null } = await readJson(req, schema);
  const space = await prisma.space.findFirst({ where: { id: spaceId, workspaceId }, select: { id: true } });
  if (!space) throw new ApiError(404, "Space not found");
  const folder = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    await requireResourcePermission(parentId ? "folder" : "space", parentId ?? spaceId, permissionLevels.EDIT, tx);
    if (parentId) {
      const folders = await tx.folder.findMany({ where: { spaceId }, select: { id: true, parentId: true } });
      const byId = new Map(folders.map((folder) => [folder.id, folder]));
      if (!byId.has(parentId)) throw new ApiError(404, "Parent folder not found");
      let ancestor: string | null = parentId;
      for (let depth = 1; ancestor; depth++) {
        if (depth >= 8) throw new ApiError(400, "Folders can be nested up to eight levels");
        ancestor = byId.get(ancestor)?.parentId ?? null;
      }
    }
    const last = await tx.folder.aggregate({ where: { spaceId, parentId }, _max: { position: true } });
    return tx.folder.create({ data: { spaceId, parentId, name, position: (last._max.position ?? 0) + 1000 } });
  });
  publish({ type: "bootstrap" });
  return NextResponse.json(folder, { status: 201 });
});
