import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { requireTaskInWorkspace } from "@/lib/integration-access";
import { ApiError, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ taskId: string }> };

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

export const POST = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { user, workspaceId } = await requireRole("GUEST");
  const task = await requireTaskInWorkspace(taskId, workspaceId);
  await requireResourcePermission("task", taskId, permissionLevels.EDIT);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "No file provided");
  if (file.size === 0) throw new ApiError(400, "File is empty");
  if (file.size > MAX_SIZE) throw new ApiError(413, "File exceeds 25 MB limit");

  const id = randomUUID();
  const contents = new Uint8Array(await file.arrayBuffer());
  const attachment = await prisma.$transaction(async (tx) => {
    const created = await tx.attachment.create({
      data: { id, taskId, name: file.name, url: `/api/attachments/${id}`, size: file.size,
        mime: file.type || "application/octet-stream", uploadedById: user.id, blob: { create: { contents } } },
    });
    await tx.activity.create({
      data: { taskId, userId: user.id, type: "attachment_added", data: { name: file.name } },
    });
    return created;
  });
  publish({ type: "list", listId: task.listId });

  return NextResponse.json(attachment, { status: 201 });
});
