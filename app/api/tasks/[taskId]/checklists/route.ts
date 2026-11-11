import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { requireRole } from "@/lib/permissions";
import { readJson, route } from "@/lib/api-helpers";

type Ctx = { params: Promise<{ taskId: string }> };
const schema = z.object({ name: z.string().trim().min(1).optional() });

export const POST = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  await requireRole("MEMBER");
  const { name } = await readJson(req, schema).catch(() => ({ name: undefined }));
  const last = await prisma.checklist.findFirst({ where: { taskId }, orderBy: { position: "desc" } });
  const checklist = await prisma.checklist.create({
    data: { taskId, name: name?.trim() || "Checklist", position: (last?.position ?? 0) + 1000 },
    include: { items: true, task: { select: { listId: true } } },
  });
  const { task, ...result } = checklist;
  publish({ type: "list", listId: task.listId });
  return NextResponse.json(result, { status: 201 });
});
