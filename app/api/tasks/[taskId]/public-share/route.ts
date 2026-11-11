import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess, requireTaskInWorkspace } from "@/lib/integration-access";
import { route } from "@/lib/api-helpers";
import { permissionLevels, requirePublicLocation, requireResourcePermission } from "@/lib/resource-permissions";

type Context = { params: Promise<{ taskId: string }> };

async function authorize(req: Request, params: Context["params"]) {
  const { taskId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true, true);
  await requireTaskInWorkspace(taskId, workspaceId);
  await requireResourcePermission("task", taskId, permissionLevels.FULL);
  return taskId;
}

export const GET = route(async (req, { params }: Context) => {
  const taskId = await authorize(req, params);
  const share = await prisma.taskPublicShare.findUnique({ where: { taskId }, select: { key: true } });
  return NextResponse.json({ key: share?.key ?? null }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route(async (req, { params }: Context) => {
  const taskId = await authorize(req, params);
  await requirePublicLocation("task", taskId);
  const share = await prisma.taskPublicShare.upsert({
    where: { taskId }, update: {}, create: { taskId, key: randomBytes(24).toString("base64url") }, select: { key: true },
  });
  return NextResponse.json(share, { headers: { "Cache-Control": "no-store" } });
});

export const DELETE = route(async (req, { params }: Context) => {
  const taskId = await authorize(req, params);
  await prisma.taskPublicShare.deleteMany({ where: { taskId } });
  return NextResponse.json({ ok: true });
});
