import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { StatusType } from "@/lib/generated/prisma/client";
import { requireRole } from "@/lib/permissions";
import { requireIntegrationAccess, requireListInWorkspace } from "@/lib/integration-access";
import { lockWorkflows } from "@/lib/status-workflows";
import { publish } from "@/lib/events";
import { ApiError, readJson, route } from "@/lib/api-helpers";

type Ctx = { params: Promise<{ listId: string }> };

const createSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  color: z.string().optional(),
  type: z.enum(["NOT_STARTED", "ACTIVE", "DONE", "CLOSED"]).optional(),
});

export const GET = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req);
  await requireListInWorkspace(listId, workspaceId);
  return NextResponse.json(await prisma.status.findMany({ where: { listId }, orderBy: { position: "asc" } }));
});

const reorderSchema = z.object({ ids: z.array(z.string()).min(1) });

export const POST = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireRole("MEMBER");
  await requireListInWorkspace(listId, workspaceId);
  const { name, color, type } = await readJson(req, createSchema);
  const status = await prisma.$transaction(async (tx) => {
    await lockWorkflows(tx, workspaceId);
    const last = await tx.status.findFirst({ where: { listId }, orderBy: { position: "desc" } });
    await tx.list.update({ where: { id: listId }, data: { inheritStatuses: false } });
    return tx.status.create({
      data: {
        listId, name, color: color ?? "#87909e", type: type ?? StatusType.NOT_STARTED,
        position: (last?.position ?? 0) + 1,
      },
    });
  });
  publish({ type: "list", listId });
  return NextResponse.json(status, { status: 201 });
});

export const PUT = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireRole("MEMBER");
  await requireListInWorkspace(listId, workspaceId);
  const { ids } = await readJson(req, reorderSchema);
  const statuses = await prisma.$transaction(async (tx) => {
    await lockWorkflows(tx, workspaceId);
    const existing = await tx.status.findMany({ where: { listId }, select: { id: true } });
    if (new Set(ids).size !== existing.length || ids.length !== existing.length || existing.some((status) => !ids.includes(status.id))) {
      throw new ApiError(400, "Choose every status from this list once");
    }
    await tx.list.update({ where: { id: listId }, data: { inheritStatuses: false } });
    for (const [position, id] of ids.entries()) await tx.status.update({ where: { id, listId }, data: { position } });
    return tx.status.findMany({ where: { listId }, orderBy: { position: "asc" } });
  });
  publish({ type: "list", listId });
  return NextResponse.json(statuses);
});
