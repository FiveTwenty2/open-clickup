import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { requireRole } from "@/lib/permissions";
import { readJson, route } from "@/lib/api-helpers";

type Ctx = { params: Promise<{ itemId: string }> };
const schema = z.object({
  name: z.string().trim().min(1).optional(),
  resolved: z.boolean().optional(),
});
const checklistList = { select: { task: { select: { listId: true } } } } as const;

export const PATCH = route(async (req, { params }: Ctx) => {
  const { itemId } = await params;
  await requireRole("MEMBER");
  const data = await readJson(req, schema);
  const { checklist, ...item } = await prisma.checklistItem.update({
    where: { id: itemId }, data, include: { checklist: checklistList },
  });
  publish({ type: "list", listId: checklist.task.listId });
  return NextResponse.json(item);
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { itemId } = await params;
  await requireRole("MEMBER");
  const { checklist } = await prisma.checklistItem.delete({
    where: { id: itemId }, select: { checklist: checklistList },
  });
  publish({ type: "list", listId: checklist.task.listId });
  return NextResponse.json({ ok: true });
});
