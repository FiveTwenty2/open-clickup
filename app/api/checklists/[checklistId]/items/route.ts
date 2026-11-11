import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { requireRole } from "@/lib/permissions";
import { readJson, route } from "@/lib/api-helpers";
import { requireChecklistEdit } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ checklistId: string }> };
const schema = z.object({ name: z.string().trim().min(1, "name is required") });

export const POST = route(async (req, { params }: Ctx) => {
  const { checklistId } = await params;
  await requireRole("GUEST");
  await requireChecklistEdit(checklistId);
  const { name } = await readJson(req, schema);
  const last = await prisma.checklistItem.findFirst({ where: { checklistId }, orderBy: { position: "desc" } });
  const { checklist, ...item } = await prisma.checklistItem.create({
    data: { checklistId, name, position: (last?.position ?? 0) + 1000 },
    include: { checklist: { select: { task: { select: { listId: true } } } } },
  });
  publish({ type: "list", listId: checklist.task.listId });
  return NextResponse.json(item, { status: 201 });
});
