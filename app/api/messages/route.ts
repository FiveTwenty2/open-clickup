import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";

async function requirePeer(workspaceId: string, userId: string, peerId: string) {
  if (peerId === userId || !await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: peerId, role: { not: "GUEST" } },
    select: { userId: true },
  })) throw new ApiError(404, "Teammate not found");
}

export const GET = route(async (req) => {
  const { user, workspaceId } = await requireRole("MEMBER");
  const { searchParams } = new URL(req.url);
  const peerId = searchParams.get("peer") ?? "";
  await requirePeer(workspaceId, user.id, peerId);
  const cursor = searchParams.get("before");
  const where = { workspaceId, OR: [
    { senderId: user.id, recipientId: peerId },
    { senderId: peerId, recipientId: user.id },
  ] };
  const before = cursor ? await prisma.directMessage.findFirst({
    where: { ...where, id: cursor }, select: { id: true, createdAt: true },
  }) : null;
  if (cursor && !before) throw new ApiError(404, "Message not found");
  const messages = await prisma.directMessage.findMany({
    where: before ? { ...where, AND: [{ OR: [
      { createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } },
    ] }] } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
  });
  return NextResponse.json({ messages: messages.slice(0, 50).reverse(), hasMore: messages.length > 50 });
});

export const POST = route(async (req) => {
  const { user, workspaceId } = await requireRole("MEMBER");
  const { peerId, body } = await readJson(req, z.object({
    peerId: z.string().min(1), body: z.string().trim().min(1).max(8000),
  }));
  await requirePeer(workspaceId, user.id, peerId);
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.directMessage.create({ data: {
      workspaceId, senderId: user.id, recipientId: peerId, body,
    } });
    await tx.notification.create({ data: {
      userId: peerId, actorId: user.id, type: "message", body: "sent you a direct message",
    } });
    return created;
  });
  publish({ type: "messages", userIds: [user.id, peerId] });
  return NextResponse.json(message, { status: 201 });
});
