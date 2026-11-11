import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ commentId: string }> };

const schema = z.object({ emoji: z.string().trim().min(1).max(8) });

/** Toggle the current user's reaction with this emoji on a comment. */
export const POST = route(async (req, { params }: Ctx) => {
  const { commentId } = await params;
  const { user, workspaceId } = await requireRole("GUEST");
  const { emoji } = await readJson(req, schema);

  const comment = await prisma.comment.findUnique({
    where: { id: commentId, task: { deletedAt: null, list: { space: { workspaceId } } } },
    select: { taskId: true, task: { select: { listId: true } } },
  });
  if (!comment) throw new ApiError(404, "Comment not found");
  await requireResourcePermission("task", comment.taskId, permissionLevels.COMMENT);

  const existing = await prisma.commentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId, userId: user.id, emoji } },
  });

  if (existing) {
    await prisma.commentReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.commentReaction.create({ data: { commentId, userId: user.id, emoji } });
  }

  publish({ type: "list", listId: comment.task.listId });
  return NextResponse.json({ ok: true, reacted: !existing });
});
