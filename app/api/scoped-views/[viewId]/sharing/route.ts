import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { requirePublicLocation } from "@/lib/resource-permissions";
import type { Prisma } from "@/lib/generated/prisma/client";

type Context = { params: Promise<{ viewId: string }> };
type Actor = Awaited<ReturnType<typeof requireRole>>;
const headers = { "Cache-Control": "no-store" };

async function forSharing(tx: Prisma.TransactionClient, viewId: string, actor: Actor) {
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${actor.workspaceId} FOR UPDATE`;
  const view = await tx.scopedView.findFirst({ where: { id: viewId, workspaceId: actor.workspaceId } });
  const admin = actor.role === "OWNER" || actor.role === "ADMIN";
  if (!view || (view.privateOwnerId ? view.privateOwnerId !== actor.user.id : !admin)) throw new ApiError(404, "View not found");
  if (view.spaceId && !await tx.space.findFirst({ where: { id: view.spaceId, workspaceId: actor.workspaceId }, select: { id: true } })) throw new ApiError(404, "View not found");
  if (view.folderId && !await tx.folder.findFirst({ where: { id: view.folderId, space: { workspaceId: actor.workspaceId } }, select: { id: true } })) throw new ApiError(404, "View not found");
  return view;
}

export const GET = route(async (_req, { params }: Context) => {
  const actor = await requireRole("MEMBER");
  const { viewId } = await params;
  const sharing = await prisma.$transaction(async (tx) => {
    const view = await forSharing(tx, viewId, actor);
    const readers = await tx.scopedViewReader.findMany({ where: { viewId }, select: { userId: true } });
    const link = await tx.scopedViewPublicLink.findUnique({ where: { viewId }, select: { key: true } });
    return { private: !!view.privateOwnerId, readers: readers.map(({ userId }) => userId), key: link?.key ?? null };
  });
  return NextResponse.json(sharing, { headers });
});

export const PATCH = route(async (req, { params }: Context) => {
  const actor = await requireRole("MEMBER");
  const { viewId } = await params;
  const action = await readJson(req, z.discriminatedUnion("action", [
    z.object({ action: z.literal("readers"), userIds: z.array(z.string().min(1)).max(200) }),
    z.object({ action: z.enum(["enable", "revoke"]) }),
  ]));
  await prisma.$transaction(async (tx) => {
    const view = await forSharing(tx, viewId, actor);
    if (action.action === "readers") {
      if (!view.privateOwnerId) throw new ApiError(400, "Choose a private view");
      const userIds = [...new Set(action.userIds)].filter((id) => id !== actor.user.id);
      const count = await tx.workspaceMember.count({ where: { workspaceId: actor.workspaceId, userId: { in: userIds } } });
      if (count !== userIds.length) throw new ApiError(400, "Select members of this workspace");
      await tx.scopedViewReader.deleteMany({ where: { viewId } });
      if (userIds.length) await tx.scopedViewReader.createMany({ data: userIds.map((userId) => ({ viewId, userId })) });
    } else if (action.action === "enable") {
      if (view.privateOwnerId) throw new ApiError(400, "Choose a workspace view to create a public link");
      if (view.spaceId) await requirePublicLocation("space", view.spaceId, tx);
      if (view.folderId) await requirePublicLocation("folder", view.folderId, tx);
      await tx.scopedViewPublicLink.upsert({
        where: { viewId }, update: {}, create: { viewId, key: randomBytes(24).toString("base64url") },
      });
    } else {
      await tx.scopedViewPublicLink.deleteMany({ where: { viewId } });
    }
  });
  publish({ type: "bootstrap" });
  return NextResponse.json({ ok: true }, { headers });
});
