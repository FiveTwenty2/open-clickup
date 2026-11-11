import { NextResponse } from "next/server";
import { z } from "zod";
import { createTask } from "@/lib/tasks";
import { requireIntegrationAccess, requireListInWorkspace, requireWorkspaceUsers, requireWorkspaceTaskType } from "@/lib/integration-access";
import { readJson, route } from "@/lib/api-helpers";

const schema = z.object({
  listId: z.string().min(1),
  name: z.string().trim().min(1, "name is required"),
  statusId: z.string().optional(),
  parentId: z.string().nullish(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).nullish(),
  assigneeIds: z.array(z.string()).optional(),
  dueDate: z.string().datetime().optional(),
  milestone: z.boolean().optional(),
  taskTypeId: z.string().min(1).nullable().optional(),
});

export const POST = route(async (req) => {
  const body = await readJson(req, schema);
  const { user, workspaceId } = await requireIntegrationAccess(req, true);
  await requireListInWorkspace(body.listId, workspaceId);
  await requireWorkspaceTaskType(workspaceId, body.taskTypeId);
  await requireWorkspaceUsers(workspaceId, body.assigneeIds ?? []);
  const task = await createTask({
    listId: body.listId,
    name: body.name,
    statusId: body.statusId,
    parentId: body.parentId ?? null,
    priority: body.priority ?? null,
    assigneeIds: body.assigneeIds ?? [],
    createdById: user.id,
    dueDate: body.dueDate,
    milestone: body.milestone,
    taskTypeId: body.taskTypeId,
  });
  return NextResponse.json(task, { status: 201 });
});
