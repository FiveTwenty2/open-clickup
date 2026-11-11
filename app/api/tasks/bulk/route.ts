import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Priority } from "@/lib/generated/prisma/client";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { trashTasks } from "@/lib/task-recovery";
import { requireWorkspaceUsers } from "@/lib/integration-access";
import { isCompletedStatus } from "@/lib/task-status";

const schema = z.object({
  ids: z.array(z.string()).min(1, "ids[] required").max(500),
  delete: z.boolean().optional(),
  patch: z
    .object({
      statusId: z.string().optional(),
      priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).nullish(),
      assigneeIds: z.array(z.string()).optional(),
      dueDate: z.string().datetime().nullable().optional(),
      archived: z.boolean().optional(),
    })
    .optional(),
});

export const POST = route(async (req) => {
  const { workspaceId } = await requireRole("MEMBER");
  const { ids: requested, patch, delete: del } = await readJson(req, schema);
  const ids = [...new Set(requested)];

  if (del) {
    const deleted = await trashTasks(workspaceId, ids);
    return NextResponse.json({ ok: true, deleted });
  }

  const targets = await prisma.task.findMany({
    where: { id: { in: ids }, deletedAt: null, list: { space: { workspaceId } } },
    select: { id: true, listId: true },
  });
  if (targets.length !== ids.length) throw new ApiError(404, "Some tasks are no longer available");
  await requireWorkspaceUsers(workspaceId, patch?.assigneeIds ?? []);

  await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = {};
    let completed = false;
    if (patch?.statusId) {
      data.statusId = patch.statusId;
      const status = await tx.status.findUnique({ where: { id: patch.statusId } });
      if (!status || targets.some((task) => task.listId !== status.listId)) {
        throw new ApiError(400, "Choose a status belonging to every selected task's list");
      }
      completed = isCompletedStatus(status.type);
      if (!completed) data.completedAt = null;
    }
    if (patch?.priority !== undefined) data.priority = patch.priority as Priority | null;
    if (patch?.dueDate !== undefined) data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
    if (patch?.archived !== undefined) data.archived = patch.archived;
    if (Object.keys(data).length) await tx.task.updateMany({ where: { id: { in: ids }, deletedAt: null }, data });
    if (completed) await tx.task.updateMany({
      where: { id: { in: ids }, deletedAt: null, completedAt: null },
      data: { completedAt: new Date() },
    });

    const assignees = patch?.assigneeIds;
    if (assignees) {
      await tx.taskAssignee.deleteMany({ where: { taskId: { in: ids } } });
      await tx.taskAssignee.createMany({
        data: ids.flatMap((taskId) => assignees.map((userId) => ({ taskId, userId }))),
        skipDuplicates: true,
      });
    }
  });

  for (const listId of new Set(targets.map((task) => task.listId))) publish({ type: "list", listId });
  return NextResponse.json({ ok: true, updated: ids.length });
});
