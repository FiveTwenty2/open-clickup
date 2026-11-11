import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { taskInclude } from "@/lib/queries";
import { ApiError, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { requireTaskInWorkspace } from "@/lib/integration-access";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ taskId: string }> };

export const POST = route(async (_req, { params }: Ctx) => {
  const { taskId } = await params;
  const { user, workspaceId } = await requireRole("GUEST");
  const { listId } = await requireTaskInWorkspace(taskId, workspaceId);
  await requireResourcePermission("task", taskId, permissionLevels.EDIT);

  const src = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignees: true,
      tags: true,
      customFieldValues: { where: { field: { listId } } },
      checklists: { orderBy: { position: "asc" }, include: { items: { orderBy: { position: "asc" } } } },
    },
  });
  if (!src) throw new ApiError(404, "Task not found");
  await requireResourcePermission(src.parentId ? "task" : "list", src.parentId ?? src.listId, permissionLevels.EDIT);

  const last = await prisma.task.findFirst({
    where: { listId: src.listId, parentId: src.parentId },
    orderBy: { position: "desc" },
  });

  const copy = await prisma.task.create({
    data: {
      listId: src.listId,
      statusId: src.statusId,
      parentId: src.parentId,
      private: src.private,
      privacyOwnerId: src.private ? user.id : null,
      name: `${src.name} (copy)`,
      description: src.description,
      priority: src.priority,
      position: (last?.position ?? src.position) + 1000,
      startDate: src.startDate,
      dueDate: src.dueDate,
      timeEstimate: src.timeEstimate,
      milestone: src.milestone,
      taskTypeId: src.taskTypeId,
      recurrence: src.recurrence,
      createdById: user.id,
      assignees: { create: src.assignees.map((a) => ({ userId: a.userId })) },
      tags: { create: src.tags.map((t) => ({ tagId: t.tagId })) },
      customFieldValues: {
        create: src.customFieldValues.map((v) => ({ customFieldId: v.customFieldId, value: v.value as object })),
      },
      checklists: {
        create: src.checklists.map((c, ci) => ({
          name: c.name,
          position: ci,
          items: { create: c.items.map((i, ii) => ({ name: i.name, resolved: i.resolved, position: ii })) },
        })),
      },
    },
    include: taskInclude,
  });

  publish({ type: "list", listId: src.listId });
  return NextResponse.json(copy, { status: 201 });
});
