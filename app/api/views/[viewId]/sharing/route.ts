import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import type { Prisma } from "@/lib/generated/prisma/client";

type Context = { params: Promise<{ viewId: string }> };
const headers = { "Cache-Control": "no-store" };

async function authorize(tx: Prisma.TransactionClient, viewId: string, actor: Awaited<ReturnType<typeof requireRole>>, lock = false) {
  const where = { id: viewId, list: { space: { workspaceId: actor.workspaceId } } };
  const list = await tx.view.findFirst({ where, select: { listId: true } });
  if (!list) throw new ApiError(404, "View not found");
  if (lock) await tx.$queryRaw`SELECT id FROM "List" WHERE id = ${list.listId} FOR UPDATE`;
  const view = await tx.view.findFirst({ where });
  const admin = actor.role === "OWNER" || actor.role === "ADMIN";
  if (!view || (view.privateOwnerId ? view.privateOwnerId !== actor.user.id : !admin)) throw new ApiError(404, "View not found");
  return view;
}

export const GET = route(async (_req, { params }: Context) => {
  const actor = await requireRole("MEMBER");
  const { viewId } = await params;
  return prisma.$transaction(async (tx) => {
    const view = await authorize(tx, viewId, actor, true);
    const readers = await tx.viewReader.findMany({ where: { viewId }, select: { userId: true } });
    const link = await tx.viewPublicLink.findUnique({ where: { viewId }, select: { key: true } });
    return NextResponse.json({ private: !!view.privateOwnerId, readers: readers.map(({ userId }) => userId), key: link?.key ?? null }, { headers });
  });
});

export const PATCH = route(async (req, { params }: Context) => {
  const actor = await requireRole("MEMBER");
  const { viewId } = await params;
  const action = await readJson(req, z.discriminatedUnion("action", [
    z.object({ action: z.literal("readers"), userIds: z.array(z.string().min(1)).max(200) }),
    z.object({ action: z.enum(["enable", "revoke"]) }),
  ]));
  const listId = await prisma.$transaction(async (tx) => {
    const view = await authorize(tx, viewId, actor, true);
    if (action.action === "readers") {
      if (!view.privateOwnerId) throw new ApiError(400, "Choose a private view");
      const userIds = [...new Set(action.userIds)].filter((id) => id !== actor.user.id);
      if (await tx.workspaceMember.count({ where: { workspaceId: actor.workspaceId, userId: { in: userIds } } }) !== userIds.length) {
        throw new ApiError(400, "Select members of this workspace");
      }
      await tx.viewReader.deleteMany({ where: { viewId } });
      if (userIds.length) await tx.viewReader.createMany({ data: userIds.map((userId) => ({ viewId, userId })) });
    } else if (action.action === "enable") {
      if (view.privateOwnerId || (view.type !== "LIST" && view.type !== "TABLE")) {
        throw new ApiError(400, "Public links are available for shared List and Table views");
      }
      await tx.viewPublicLink.upsert({
        where: { viewId }, update: {}, create: { viewId, key: randomBytes(24).toString("base64url") },
      });
    } else {
      await tx.viewPublicLink.deleteMany({ where: { viewId } });
    }
    return view.listId;
  });
  publish({ type: "list", listId });
  return NextResponse.json({ ok: true }, { headers });
});
