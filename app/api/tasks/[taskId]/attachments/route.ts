import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { requireTaskInWorkspace } from "@/lib/integration-access";
import { ApiError, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ taskId: string }> };

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export const POST = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { user, workspaceId } = await requireRole("MEMBER");
  const task = await requireTaskInWorkspace(taskId, workspaceId);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "No file provided");
  if (file.size === 0) throw new ApiError(400, "File is empty");
  if (file.size > MAX_SIZE) throw new ApiError(413, "File exceeds 25 MB limit");

  const ext = path.extname(file.name).slice(0, 12).replace(/[^a-zA-Z0-9.]/g, "");
  const storedName = `${randomUUID()}${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, storedName), bytes);

  const attachment = await prisma.attachment.create({
    data: {
      taskId,
      name: file.name,
      url: `/uploads/${storedName}`,
      size: file.size,
      mime: file.type || "application/octet-stream",
      uploadedById: user.id,
    },
  });

  await prisma.activity.create({
    data: { taskId, userId: user.id, type: "attachment_added", data: { name: file.name } },
  });
  publish({ type: "list", listId: task.listId });

  return NextResponse.json(attachment, { status: 201 });
});
