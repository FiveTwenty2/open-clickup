import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { requireRole } from "@/lib/permissions";
import { readJson, route } from "@/lib/api-helpers";
import { requireChecklistEdit } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ checklistId: string }> };
const schema = z.object({ name: z.string().trim().min(1) });

export const PATCH = route(async (req, { params }: Ctx) => {
  const { checklistId } = await params;
  await requireRole("GUEST");
  await requireChecklistEdit(checklistId);
  const { name } = await readJson(req, schema);
  const { task, ...checklist } = await prisma.checklist.update({
    where: { id: checklistId },
    data: { name },
    include: { task: { select: { listId: true } } },
  });
  publish({ type: "list", listId: task.listId });
  return NextResponse.json(checklist);
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { checklistId } = await params;
  await requireRole("GUEST");
  await requireChecklistEdit(checklistId);
  const { task } = await prisma.checklist.delete({
    where: { id: checklistId },
    select: { task: { select: { listId: true } } },
  });
  publish({ type: "list", listId: task.listId });
  return NextResponse.json({ ok: true });
});
