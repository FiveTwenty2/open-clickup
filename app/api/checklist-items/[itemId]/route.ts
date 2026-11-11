import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { requireChecklistEdit } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ itemId: string }> };
const schema = z.object({
  name: z.string().trim().min(1).optional(),
  resolved: z.boolean().optional(),
});
const checklistList = { select: { task: { select: { listId: true } } } } as const;

async function authorize(itemId: string) {
  await requireRole("GUEST");
  const item = await prisma.checklistItem.findUnique({ where: { id: itemId }, select: { checklistId: true } });
  if (!item) throw new ApiError(404, "Checklist item not found");
  await requireChecklistEdit(item.checklistId);
}

export const PATCH = route(async (req, { params }: Ctx) => {
  const { itemId } = await params;
  await authorize(itemId);
  const data = await readJson(req, schema);
  const { checklist, ...item } = await prisma.checklistItem.update({
    where: { id: itemId }, data, include: { checklist: checklistList },
  });
  publish({ type: "list", listId: checklist.task.listId });
  return NextResponse.json(item);
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { itemId } = await params;
  await authorize(itemId);
  const { checklist } = await prisma.checklistItem.delete({
    where: { id: itemId }, select: { checklist: checklistList },
  });
  publish({ type: "list", listId: checklist.task.listId });
  return NextResponse.json({ ok: true });
});
