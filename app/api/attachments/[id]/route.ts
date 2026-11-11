import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { attachmentResponse, readLegacyUpload, removeLegacyAttachment } from "@/lib/attachment-files";
import { ApiError, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ id: string }> };
const scope = (id: string, workspaceId: string) => ({
  id, task: { deletedAt: null, list: { space: { workspaceId } } },
});

export const GET = route(async (req, { params }: Ctx) => {
  const { id } = await params;
  const { workspaceId } = await requireIntegrationAccess(req);
  const attachment = await prisma.attachment.findFirst({
    where: scope(id, workspaceId), select: { url: true, name: true, blob: { select: { contents: true } } },
  });
  if (!attachment) throw new ApiError(404, "Attachment not found");
  const bytes = attachment.blob?.contents ?? (attachment.url.startsWith("/uploads/") ? await readLegacyUpload(attachment.url.slice(9)) : null);
  if (!bytes) throw new ApiError(404, "Attachment not found");
  return attachmentResponse(bytes, attachment.name, new URL(req.url).searchParams.get("preview") === "image");
});

export const DELETE = route(async (req, { params }: Ctx) => {
  const { id } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true, true);
  const where = scope(id, workspaceId);
  const attachment = await prisma.attachment.findFirst({
    where, select: { url: true, taskId: true, task: { select: { listId: true } } },
  });
  if (!attachment) throw new ApiError(404, "Attachment not found");
  await requireResourcePermission("task", attachment.taskId, permissionLevels.EDIT);
  if (!(await prisma.attachment.deleteMany({ where })).count) throw new ApiError(404, "Attachment not found");
  await removeLegacyAttachment(attachment.url);
  publish({ type: "list", listId: attachment.task.listId });
  return NextResponse.json({ ok: true });
});
