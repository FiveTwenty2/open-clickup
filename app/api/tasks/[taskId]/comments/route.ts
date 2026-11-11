import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { requireTaskInWorkspace } from "@/lib/integration-access";
import { userSelect, commentFileSelect } from "@/lib/queries";
import { ApiError, readJson, route, validateInput } from "@/lib/api-helpers";
import { extractMentionIds } from "@/lib/mentions";
import { MAX_COMMENT_FILES, MAX_COMMENT_FILE_MIB, MAX_COMMENT_FILE_BYTES } from "@/lib/comment-file-limits";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ taskId: string }> };
const schema = z.object({ body: z.string().trim().max(50000), parentId: z.string().nullish() });


export const POST = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { user, workspaceId } = await requireRole("MEMBER");
  const task = await requireTaskInWorkspace(taskId, workspaceId);
  const contentLength = Number(req.headers.get("content-length"));
  if (contentLength > MAX_COMMENT_FILE_BYTES + 1024 * 1024) throw new ApiError(413, "Comment upload is too large");
  const form = req.headers.get("content-type")?.startsWith("multipart/form-data")
    ? await req.formData().catch(() => { throw new ApiError(400, "Invalid attachment upload"); })
    : null;
  const { body, parentId } = form
    ? validateInput({ body: form.get("body") ?? "", parentId: form.get("parentId") }, schema)
    : await readJson(req, schema);
  const uploads = form?.getAll("files") ?? [];
  if (uploads.length > MAX_COMMENT_FILES || uploads.some((file) => !(file instanceof File) || file.size === 0 || !file.name)) {
    throw new ApiError(400, "Select up to five non-empty files");
  }
  const files = uploads as File[];
  if (files.reduce((total, file) => total + file.size, 0) > MAX_COMMENT_FILE_BYTES) throw new ApiError(413, `Files exceed ${MAX_COMMENT_FILE_MIB} MB combined`);
  if ((!body || body === "<p></p>") && !files.length) throw new ApiError(400, "Write a comment or attach a file");
  const attachments = await Promise.all(files.map(async (file) => ({
    name: file.name.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255) || "Attachment",
    size: file.size, contents: new Uint8Array(await file.arrayBuffer()),
  })));

  const { comment, recipients } = await prisma.$transaction(async (tx) => {
    const parent = parentId ? await tx.comment.findFirst({
      where: { id: parentId, taskId, parentId: null }, select: { userId: true },
    }) : null;
    if (parentId && !parent) throw new ApiError(404, "Comment thread not found");
    const created = await tx.comment.create({
      data: { taskId, userId: user.id, body, parentId, files: { create: attachments } },
      include: { user: { select: userSelect }, reactions: true, files: { select: commentFileSelect } },
    });
    await tx.activity.create({ data: {
      taskId, userId: user.id, type: "commented",
      data: { commentId: created.id, files: attachments.map((file) => file.name) },
    } });
    const followers = await tx.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { assignees: { select: { userId: true } }, watchers: { select: { userId: true } } },
    });
    const mentioned = new Set(extractMentionIds(body));
    const ids = [...mentioned, ...followers.assignees.map((row) => row.userId), ...followers.watchers.map((row) => row.userId)];
    if (parent) ids.push(parent.userId);
    const members = await tx.workspaceMember.findMany({
      where: { workspaceId, userId: { in: ids, not: user.id } }, select: { userId: true },
    });
    const notifications = members.map(({ userId }) => {
      const type = mentioned.has(userId) ? "mention" : userId === parent?.userId ? "reply" : "comment";
      const text = { mention: "mentioned you in a comment", reply: "replied to your comment", comment: "commented on a task you follow" };
      return { userId, actorId: user.id, taskId, commentId: parentId ?? created.id, type, body: text[type] };
    });
    if (notifications.length) await tx.notification.createMany({ data: notifications });
    return { comment: created, recipients: members.map((member) => member.userId) };
  });
  publish({ type: "list", listId: task.listId });
  if (recipients.length) publish({ type: "notifications", userIds: recipients });
  return NextResponse.json(comment, { status: 201 });
});
