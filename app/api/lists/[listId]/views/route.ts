import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { requireListInWorkspace } from "@/lib/integration-access";
import { readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ listId: string }> };
const schema = z.object({
  name: z.string().trim().min(1).max(80),
  private: z.boolean().optional(),
  type: z.enum(["LIST", "BOARD", "CALENDAR", "GANTT", "TABLE"]),
});

export const POST = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId, user } = await requireRole("MEMBER");
  await requireListInWorkspace(listId, workspaceId);
  const { private: isPrivate, ...body } = await readJson(req, schema);
  const last = await prisma.view.findFirst({ where: { listId }, orderBy: { position: "desc" } });
  const view = await prisma.view.create({ data: { ...body, listId, privateOwnerId: isPrivate ? user.id : null, position: (last?.position ?? 0) + 1 } });
  publish({ type: "list", listId });
  return NextResponse.json(view, { status: 201 });
});
