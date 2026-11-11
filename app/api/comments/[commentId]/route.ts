import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { commentFileSelect, userSelect } from "@/lib/queries";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { extractMentionIds } from "@/lib/mentions";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ commentId: string }> };
// editing the body is author-only; resolving a thread is allowed for any member
const schema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(50000).optional(),
  resolved: z.boolean().optional(),
});

async function load(commentId: string, workspaceId: string) {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, task: { deletedAt: null, list: { space: { workspaceId } } } },
    include: { task: { select: { listId: true } } },
  });
  if (!comment) throw new ApiError(404, "Comment not found");
  return comment;
}

export const PATCH = route(async (req, { params }: Ctx) => {
  const { commentId } = await params;
  const { user, workspaceId } = await requireRole("MEMBER");
  const { body, resolved } = await readJson(req, schema);
  const existing = await load(commentId, workspaceId);

  if (body !== undefined && existing.userId !== user.id) {
    throw new ApiError(403, "You can only edit your own comments");
  }

  const data: Record<string, unknown> = {};
  if (body !== undefined) data.body = body;
  if (resolved !== undefined) data.resolved = resolved;

  const { comment, recipients } = await prisma.$transaction(async (tx) => {
    const updated = await tx.comment.update({
      where: { id: commentId }, data,
      include: { user: { select: userSelect }, reactions: true, files: { select: commentFileSelect } },
    });
    const types: string[] = [];
    if (body !== undefined && body !== existing.body) types.push("comment_edited");
    if (resolved !== undefined && resolved !== existing.resolved) types.push(resolved ? "comment_resolved" : "comment_reopened");
    if (types.length) await tx.activity.createMany({
      data: types.map((type) => ({ taskId: existing.taskId, userId: user.id, type, data: { commentId } })),
    });
    const previous = new Set(extractMentionIds(existing.body));
    const added = body === undefined ? [] : extractMentionIds(body).filter((id) => id !== user.id && !previous.has(id));
    const recipients = added.length ? await tx.workspaceMember.findMany({
      where: { workspaceId, userId: { in: added } }, select: { userId: true },
    }) : [];
    if (recipients.length) await tx.notification.createMany({
      data: recipients.map(({ userId }) => ({
        userId, actorId: user.id, taskId: existing.taskId, commentId: existing.parentId ?? commentId,
        type: "mention", body: "mentioned you in a comment",
      })),
    });
    return { comment: updated, recipients: recipients.map((member) => member.userId) };
  });
  if (recipients.length) publish({ type: "notifications", userIds: recipients });
  publish({ type: "list", listId: existing.task.listId });
  return NextResponse.json(comment);
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { commentId } = await params;
  const { user, workspaceId } = await requireRole("MEMBER");
  const existing = await load(commentId, workspaceId);
  if (existing.userId !== user.id) throw new ApiError(403, "You can only delete your own comments");

  await prisma.$transaction([
    prisma.comment.delete({ where: { id: commentId } }),
    prisma.activity.create({ data: { taskId: existing.taskId, userId: user.id, type: "comment_deleted", data: { commentId } } }),
  ]);
  publish({ type: "list", listId: existing.task.listId });
  return NextResponse.json({ ok: true });
});
