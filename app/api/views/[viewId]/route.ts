import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { Prisma } from "@/lib/generated/prisma/client";

type Ctx = { params: Promise<{ viewId: string }> };
const schema = z.object({
  config: z.any().optional(),
  name: z.string().trim().min(1).max(80).optional(),
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const { viewId } = await params;
  const { workspaceId } = await requireRole("MEMBER");
  const body = await readJson(req, schema);
  const data: Record<string, unknown> = {};
  if (body.config !== undefined) data.config = body.config;
  if (body.name !== undefined) data.name = body.name;
  const view = await prisma.view.update({ where: { id: viewId, list: { space: { workspaceId } } }, data });
  if (body.name !== undefined) publish({ type: "list", listId: view.listId });
  return NextResponse.json(view);
});

export const POST = route(async (_req, { params }: Ctx) => {
  const { viewId } = await params;
  const { workspaceId } = await requireRole("MEMBER");
  const view = await prisma.view.findFirst({ where: { id: viewId, list: { space: { workspaceId } } } });
  if (!view) throw new ApiError(404, "View not found");
  const last = await prisma.view.aggregate({ where: { listId: view.listId }, _max: { position: true } });
  const copy = await prisma.view.create({
    data: { listId: view.listId, type: view.type, name: `${view.name.slice(0, 73)} (copy)`, position: (last._max.position ?? 0) + 1, config: view.config ?? Prisma.DbNull },
  });
  publish({ type: "list", listId: view.listId });
  return NextResponse.json(copy, { status: 201 });
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { viewId } = await params;
  const { workspaceId } = await requireRole("MEMBER");
  const listId = await prisma.$transaction(async (tx) => {
    const view = await tx.view.findFirst({ where: { id: viewId, list: { space: { workspaceId } } } });
    if (!view) throw new ApiError(404, "View not found");
    await tx.$queryRaw`SELECT id FROM "List" WHERE id = ${view.listId} FOR UPDATE`;
    if (await tx.view.count({ where: { listId: view.listId } }) <= 1) throw new ApiError(409, "Keep at least one view");
    await tx.view.delete({ where: { id: viewId } });
    return view.listId;
  });
  publish({ type: "list", listId });
  return NextResponse.json({ ok: true });
});
