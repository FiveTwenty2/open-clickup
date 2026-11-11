import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { publish } from "@/lib/events";
import { readJson, route } from "@/lib/api-helpers";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ spaceId: string }> };
const schema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z.string().optional(),
  icon: z.string().nullish(),
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const { spaceId } = await params;
  const { workspaceId } = await requireRole("GUEST");
  await requireResourcePermission("space", spaceId, permissionLevels.EDIT);
  const data = await readJson(req, schema);
  const space = await prisma.space.update({ where: { id: spaceId, workspaceId }, data });
  publish({ type: "bootstrap" });
  return NextResponse.json(space);
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { spaceId } = await params;
  const { workspaceId } = await requireRole("ADMIN");
  await requireResourcePermission("space", spaceId, permissionLevels.FULL);
  await prisma.space.delete({ where: { id: spaceId, workspaceId } });
  publish({ type: "bootstrap" });
  return NextResponse.json({ ok: true });
});
