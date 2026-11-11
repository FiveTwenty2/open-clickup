import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolvePlacementStatus } from "@/lib/status-workflows";
import { updateTask } from "@/lib/tasks";
import { getTaskDetail } from "@/lib/queries";
import { requireRole } from "@/lib/permissions";
import { requireIntegrationAccess, requireTaskInWorkspace, requireWorkspaceUsers, requireWorkspaceTaskType } from "@/lib/integration-access";
import { readJson, route, ApiError } from "@/lib/api-helpers";
import { trashTasks } from "@/lib/task-recovery";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ taskId: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().nullish(),
  statusId: z.string().optional(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).nullish(),
  position: z.number().optional(),
  placementListId: z.string().min(1).optional(),
  startDate: z.string().datetime().nullish(),
  dueDate: z.string().datetime().nullish(),
  timeEstimate: z.number().int().nullish(),
  recurrence: z.enum(["DAILY", "WEEKDAYS", "WEEKLY", "BIWEEKLY", "MONTHLY"]).nullish(),
  archived: z.boolean().optional(),
  milestone: z.boolean().optional(),
  taskTypeId: z.string().min(1).nullable().optional(),
  assigneeIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  watcherIds: z.array(z.string()).optional(),
});

export const GET = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req);
  await requireTaskInWorkspace(taskId, workspaceId);
  const permission = await requireResourcePermission("task", taskId, permissionLevels.VIEW);
  const task = await getTaskDetail(taskId);
  if (!task) throw new ApiError(404, "Task not found");
  return NextResponse.json({ ...task, permission });
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { placementListId, ...patch } = await readJson(req, patchSchema);
  const { user, workspaceId } = await requireIntegrationAccess(req, true, true);
  const target = await requireTaskInWorkspace(taskId, workspaceId);
  await requireResourcePermission("task", taskId, permissionLevels.EDIT);
  await requireWorkspaceTaskType(workspaceId, patch.taskTypeId);
  await requireWorkspaceUsers(workspaceId, [...(patch.assigneeIds ?? []), ...(patch.watcherIds ?? [])]);
  if (patch.tagIds?.length) {
    const ids = [...new Set(patch.tagIds)];
    const count = await prisma.tag.count({ where: { id: { in: ids }, spaceId: target.list.spaceId } });
    if (count !== ids.length) throw new ApiError(400, "Select tags from this space");
  }
  if (patch.statusId) patch.statusId = (await resolvePlacementStatus(prisma, { id: taskId, listId: target.listId }, patch.statusId)).id;
  const task = await updateTask(taskId, patch, user.id, placementListId);
  return NextResponse.json(task);
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const { taskId } = await params;
  const { workspaceId, user } = await requireRole("GUEST");
  await trashTasks(workspaceId, [taskId], user.id);
  return NextResponse.json({ ok: true });
});
