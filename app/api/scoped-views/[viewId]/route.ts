import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { Prisma } from "@/lib/generated/prisma/client";
import { savedViewConfig } from "@/lib/saved-view-config";

type Context = { params: Promise<{ viewId: string }> };
type Actor = Awaited<ReturnType<typeof requireRole>>;
const fields = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  config: savedViewConfig.nullable().optional(),
  makeDefault: z.literal(true).optional(),
  protected: z.boolean().optional(),
  private: z.boolean().optional(),
});

async function viewForEdit(tx: Prisma.TransactionClient, id: string, actor: Actor) {
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${actor.workspaceId} FOR UPDATE`;
  const view = await tx.scopedView.findFirst({
    where: { id, workspaceId: actor.workspaceId, OR: [{ privateOwnerId: null }, { privateOwnerId: actor.user.id }] },
  });
  if (!view) throw new ApiError(404, "View not found");
  if (view.spaceId && !await tx.space.findFirst({ where: { id: view.spaceId, workspaceId: actor.workspaceId }, select: { id: true } })) throw new ApiError(404, "View not found");
  if (view.folderId && !await tx.folder.findFirst({ where: { id: view.folderId, space: { workspaceId: actor.workspaceId } }, select: { id: true } })) throw new ApiError(404, "View not found");
  return view;
}

export const PATCH = route(async (req, { params }: Context) => {
  const actor = await requireRole("MEMBER");
  const { viewId } = await params;
  const changes = await readJson(req, fields);
  const admin = actor.role === "OWNER" || actor.role === "ADMIN";
  const updated = await prisma.$transaction(async (tx) => {
    const view = await viewForEdit(tx, viewId, actor);
    if (view.protected && !admin) throw new ApiError(403, "This view is locked");
    if (!admin && (changes.protected !== undefined || (changes.private !== undefined && !view.privateOwnerId))) {
      throw new ApiError(403, "Only admins can change protection or privatize a shared view");
    }
    const scope = { workspaceId: view.workspaceId, spaceId: view.spaceId, folderId: view.folderId };
    const ownerId = changes.private === undefined ? view.privateOwnerId : changes.private ? actor.user.id : null;
    if (changes.makeDefault && ownerId) throw new ApiError(400, "Only shared views can be the default");
    const data: Prisma.ScopedViewUncheckedUpdateInput = {};
    if (changes.name !== undefined) data.name = changes.name;
    if (changes.config !== undefined) data.config = changes.config ?? Prisma.DbNull;
    if (changes.protected !== undefined) data.protected = changes.protected;
    if (changes.private !== undefined) data.privateOwnerId = ownerId;
    if (changes.makeDefault) {
      const first = await tx.scopedView.aggregate({ where: { ...scope, privateOwnerId: null }, _min: { position: true } });
      data.position = (first._min.position ?? 0) - 1;
    }
    if (ownerId !== view.privateOwnerId) {
      await tx.scopedViewReader.deleteMany({ where: { viewId } });
      await tx.scopedViewPublicLink.deleteMany({ where: { viewId } });
    }
    return tx.scopedView.update({ where: { id: viewId }, data });
  });
  publish({ type: "bootstrap" });
  return NextResponse.json(updated);
});

export const POST = route(async (_req, { params }: Context) => {
  const actor = await requireRole("MEMBER");
  const { viewId } = await params;
  const copy = await prisma.$transaction(async (tx) => {
    const view = await viewForEdit(tx, viewId, actor);
    const scope = { workspaceId: view.workspaceId, spaceId: view.spaceId, folderId: view.folderId };
    const last = await tx.scopedView.aggregate({ where: scope, _max: { position: true } });
    return tx.scopedView.create({
      data: { ...scope, name: `${view.name.slice(0, 73)} (copy)`, type: view.type, privateOwnerId: view.privateOwnerId,
        position: (last._max.position ?? 0) + 1, config: view.config ?? Prisma.DbNull },
    });
  });
  publish({ type: "bootstrap" });
  return NextResponse.json(copy, { status: 201 });
});

export const DELETE = route(async (_req, { params }: Context) => {
  const actor = await requireRole("MEMBER");
  const { viewId } = await params;
  await prisma.$transaction(async (tx) => {
    const view = await viewForEdit(tx, viewId, actor);
    if (view.protected && actor.role !== "OWNER" && actor.role !== "ADMIN") throw new ApiError(403, "This view is locked");
    await tx.scopedView.delete({ where: { id: viewId } });
  });
  publish({ type: "bootstrap" });
  return NextResponse.json({ ok: true });
});
