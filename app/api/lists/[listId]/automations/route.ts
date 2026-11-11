import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readJson, route, ApiError } from "@/lib/api-helpers";
import { requireRole } from "@/lib/permissions";
import { requireListInWorkspace, requireWorkspaceUsers } from "@/lib/integration-access";

type Ctx = { params: Promise<{ listId: string }> };
const input = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.enum(["CREATED", "STATUS_CHANGED"]),
  statusId: z.string().optional(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).optional(),
  dueDays: z.number().int().min(0).max(365).optional(),
  assigneeId: z.string().optional(),
});

async function access(listId: string, write: boolean) {
  const actor = await requireRole(write ? "ADMIN" : "GUEST");
  await requireListInWorkspace(listId, actor.workspaceId);
  return actor;
}

export const GET = route(async (_req, { params }: Ctx) => {
  const { listId } = await params;
  await access(listId, false);
  return NextResponse.json(await prisma.taskAutomation.findMany({ where: { listId }, orderBy: { createdAt: "asc" } }));
});

export const POST = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await access(listId, true);
  const rule = await readJson(req, input);
  if (rule.trigger === "STATUS_CHANGED" && (!rule.statusId || !(await prisma.status.findFirst({ where: { id: rule.statusId, listId }, select: { id: true } })))) {
    throw new ApiError(400, "Select a status from this list");
  }
  if (!rule.priority && rule.dueDays === undefined && !rule.assigneeId) throw new ApiError(400, "Choose at least one action");
  if (rule.assigneeId) await requireWorkspaceUsers(workspaceId, [rule.assigneeId]);
  const created = await prisma.taskAutomation.create({ data: { ...rule, listId, statusId: rule.trigger === "STATUS_CHANGED" ? rule.statusId : null } });
  return NextResponse.json(created, { status: 201 });
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  await access(listId, true);
  const { id, enabled } = await readJson(req, z.object({ id: z.string().min(1), enabled: z.boolean() }));
  const rule = await prisma.taskAutomation.update({ where: { id, listId }, data: { enabled } });
  return NextResponse.json(rule);
});

export const DELETE = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  await access(listId, true);
  const { id } = await readJson(req, z.object({ id: z.string().min(1) }));
  const result = await prisma.taskAutomation.deleteMany({ where: { id, listId } });
  if (!result.count) throw new ApiError(404, "Rule not found");
  return NextResponse.json({ ok: true });
});
