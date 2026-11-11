import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";

const type = z.object({ name: z.string().trim().min(1).max(60), color: z.string().regex(/^#[a-f0-9]{6}$/i) });

export const GET = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req);
  return NextResponse.json(await prisma.workspaceTaskType.findMany({
    where: { workspaceId }, select: { id: true, name: true, color: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  }));
});

async function admin(req: Request) {
  const { workspaceId, role } = await requireIntegrationAccess(req, true);
  if (role !== "ADMIN" && role !== "OWNER") throw new ApiError(403, "Only workspace admins can manage task types");
  return workspaceId;
}

async function unique<T>(result: Promise<T>) {
  return result.catch((error) => {
    if (error?.code === "P2002") throw new ApiError(409, "A task type already has that name");
    throw error;
  });
}

export const POST = route(async (req) => {
  const workspaceId = await admin(req);
  const fields = await readJson(req, type);
  const created = await unique(prisma.workspaceTaskType.create({ data: { workspaceId, ...fields } }));
  publish({ type: "bootstrap" });
  return NextResponse.json(created, { status: 201 });
});

export const PATCH = route(async (req) => {
  const workspaceId = await admin(req);
  const { id, ...fields } = await readJson(req, type.extend({ id: z.string().min(1) }));
  const updated = await unique(prisma.workspaceTaskType.update({ where: { id, workspaceId }, data: fields }));
  publish({ type: "bootstrap" });
  return NextResponse.json(updated);
});

export const DELETE = route(async (req) => {
  const workspaceId = await admin(req);
  const { id } = await readJson(req, z.object({ id: z.string().min(1) }));
  await prisma.workspaceTaskType.delete({ where: { id, workspaceId } });
  publish({ type: "bootstrap" });
  return NextResponse.json({ ok: true });
});
