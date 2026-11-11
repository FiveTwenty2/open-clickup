import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { requireIntegrationAccess, requireTaskInWorkspace } from "@/lib/integration-access";
import { publish } from "@/lib/events";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";
import { visibleSecondaryListIds } from "@/lib/task-placements";

type Ctx = { params: Promise<{ taskId: string; fieldId: string }> };
const schema = z.object({ value: z.any() });

// upsert (or clear) a custom field value for a task
export const PUT = route(async (req, { params }: Ctx) => {
  const { taskId, fieldId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true, true);
  await requireTaskInWorkspace(taskId, workspaceId);
  const field = await prisma.customField.findFirst({
    where: { id: fieldId, list: { space: { workspaceId } } },
    select: { listId: true },
  });
  if (!field) throw new ApiError(404, "Custom field not found for this task");
  const { value } = await readJson(req, schema);

  const isEmpty =
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

  const saved = await prisma.$transaction(async (tx) => {
    await requireResourcePermission("task", taskId, permissionLevels.EDIT, tx);
    await requireResourcePermission("list", field.listId, permissionLevels.EDIT, tx);
    await tx.$queryRaw`SELECT id FROM "List" WHERE id = ${field.listId} FOR NO KEY UPDATE`;
    const task = await tx.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { listId: true } });
    if (!task) throw new ApiError(404, "Task not found");
    if (field.listId !== task.listId) {
      if (!(await visibleSecondaryListIds(tx, taskId)).includes(field.listId)) {
        throw new ApiError(404, "Custom field not found for this task");
      }
    }
    if (isEmpty) {
      await tx.customFieldValue.deleteMany({ where: { taskId, customFieldId: fieldId } });
      return { listId: task.listId, result: { ok: true, cleared: true } };
    }
    const result = await tx.customFieldValue.upsert({
      where: { taskId_customFieldId: { taskId, customFieldId: fieldId } },
      create: { taskId, customFieldId: fieldId, value },
      update: { value },
    });
    return { listId: task.listId, result };
  });
  publish({ type: "list", listId: saved.listId });
  if (field.listId !== saved.listId) publish({ type: "list", listId: field.listId });
  return NextResponse.json(saved.result);
});
