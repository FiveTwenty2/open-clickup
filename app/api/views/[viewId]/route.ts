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
  makeDefault: z.literal(true).optional(),
  protected: z.boolean().optional(),
  private: z.boolean().optional(),
});

function accessible(id: string, workspaceId: string, userId: string) {
  return { id, list: { space: { workspaceId } }, OR: [{ privateOwnerId: null }, { privateOwnerId: userId }] };
}

async function loadLocked(tx: Prisma.TransactionClient, id: string, workspaceId: string, userId: string) {
  const where = accessible(id, workspaceId, userId);
  const target = await tx.view.findFirst({ where, select: { listId: true } });
  if (!target) throw new ApiError(404, "View not found");
  await tx.$queryRaw`SELECT id FROM "List" WHERE id = ${target.listId} FOR UPDATE`;
  const view = await tx.view.findFirst({ where });
  if (!view) throw new ApiError(404, "View not found");
  return view;
}

async function keepPublicView(tx: Prisma.TransactionClient, listId: string) {
  if (await tx.view.count({ where: { listId, privateOwnerId: null } }) <= 1) {
    throw new ApiError(409, "Keep at least one shared view");
  }
}

export const PATCH = route(async (req, { params }: Ctx) => {
  const { viewId } = await params;
  const { workspaceId, user, role } = await requireRole("MEMBER");
  const body = await readJson(req, schema);
  const admin = role === "ADMIN" || role === "OWNER";
  const view = await prisma.$transaction(async (tx) => {
    const current = await loadLocked(tx, viewId, workspaceId, user.id);
    if (current.protected && !admin) throw new ApiError(403, "This view is locked");
    if (!admin && (body.protected !== undefined || (body.private !== undefined && !current.privateOwnerId))) {
      throw new ApiError(403, "Only admins can change protection or privatize a shared view");
    }
    const ownerId = body.private === undefined ? current.privateOwnerId : body.private ? user.id : null;
    if (ownerId && !current.privateOwnerId) await keepPublicView(tx, current.listId);
    if (body.makeDefault && ownerId) throw new ApiError(400, "Only shared views can be the list default");
    const data: Prisma.ViewUncheckedUpdateInput = {};
    if (body.config !== undefined) data.config = body.config === null ? Prisma.DbNull : body.config;
    if (body.name !== undefined) data.name = body.name;
    if (body.private !== undefined) data.privateOwnerId = ownerId;
    if (body.protected !== undefined) data.protected = body.protected;
    if (body.makeDefault) {
      const first = await tx.view.aggregate({ where: { listId: current.listId, privateOwnerId: null }, _min: { position: true } });
      data.position = (first._min.position ?? 0) - 1;
    }
    if (body.private !== undefined && ownerId !== current.privateOwnerId) {
      await tx.viewReader.deleteMany({ where: { viewId } });
      await tx.viewPublicLink.deleteMany({ where: { viewId } });
    }
    return tx.view.update({ where: { id: viewId }, data });
  });
  if (Object.keys(body).some((key) => key !== "config")) publish({ type: "list", listId: view.listId });
  return NextResponse.json(view);
});

export const POST = route(async (_req, { params }: Ctx) => {
  const { viewId } = await params;
  const { workspaceId, user } = await requireRole("MEMBER");
  const copy = await prisma.$transaction(async (tx) => {
    const view = await loadLocked(tx, viewId, workspaceId, user.id);
    const last = await tx.view.aggregate({ where: { listId: view.listId }, _max: { position: true } });
    return tx.view.create({
      data: { listId: view.listId, type: view.type, name: `${view.name.slice(0, 73)} (copy)`,
        position: (last._max.position ?? 0) + 1, config: view.config ?? Prisma.DbNull, privateOwnerId: view.privateOwnerId },
    });
  });
  publish({ type: "list", listId: copy.listId });
  return NextResponse.json(copy, { status: 201 });
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { viewId } = await params;
  const { workspaceId, user, role } = await requireRole("MEMBER");
  const listId = await prisma.$transaction(async (tx) => {
    const view = await loadLocked(tx, viewId, workspaceId, user.id);
    if (view.protected && role !== "ADMIN" && role !== "OWNER") throw new ApiError(403, "This view is locked");
    if (!view.privateOwnerId) await keepPublicView(tx, view.listId);
    await tx.view.delete({ where: { id: viewId } });
    return view.listId;
  });
  publish({ type: "list", listId });
  return NextResponse.json({ ok: true });
});
