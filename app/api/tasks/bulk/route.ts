import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Priority, StatusType } from "@/lib/generated/prisma/client";
import { requireRole } from "@/lib/permissions";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { trashTasks } from "@/lib/task-recovery";
import { requireWorkspaceUsers } from "@/lib/integration-access";
import { resolvePlacementStatus } from "@/lib/status-workflows";
import { isCompletedStatus } from "@/lib/task-status";
import { permissionLevels } from "@/lib/resource-permissions";

const schema = z.object({
  ids: z.array(z.string()).min(1, "ids[] required").max(500),
  delete: z.boolean().optional(),
  patch: z
    .object({
      statusId: z.string().optional(),
      status: z.object({ name: z.string().min(1).max(80), type: z.enum(StatusType) }).optional(),
      priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).nullish(),
      assigneeIds: z.array(z.string()).optional(),
      dueDate: z.string().datetime().nullable().optional(),
      archived: z.boolean().optional(),
    })
    .optional(),
});

export const POST = route(async (req) => {
  const { workspaceId, user } = await requireRole("MEMBER");
  const { ids: requested, patch, delete: del } = await readJson(req, schema);
  const ids = [...new Set(requested)];
  if (patch?.statusId && patch.status) throw new ApiError(400, "Choose one status selector");

  if (del) {
    const deleted = await trashTasks(workspaceId, ids, user.id);
    return NextResponse.json({ ok: true, deleted });
  }

  const targets = await prisma.task.findMany({
    where: { id: { in: ids }, deletedAt: null, list: { space: { workspaceId } } },
    select: { id: true, listId: true },
  });
  if (targets.length !== ids.length) throw new ApiError(404, "Some tasks are no longer available");
  await requireWorkspaceUsers(workspaceId, patch?.assigneeIds ?? []);

  await prisma.$transaction(async (tx) => {
    const [access] = await tx.$queryRaw<{ allowed: boolean }[]>`
      SELECT bool_and(oc_acl('task', id) >= ${permissionLevels.EDIT}::integer) AS allowed
      FROM unnest(${ids}::text[]) AS selected(id)
    `;
    if (!access?.allowed) throw new ApiError(403, "You do not have permission to edit every selected task");
    const data: Record<string, unknown> = {};
    const targetStatus = patch?.statusId;
    const status = patch?.status;
    if (targetStatus || status) {
      const matching = status ? await tx.status.findMany({
        where: { listId: { in: [...new Set(targets.map(({ listId }) => listId))] }, type: status.type,
          name: { equals: status.name, mode: "insensitive" } },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      }) : [];
      for (const target of targets) {
        const selected = targetStatus ? await resolvePlacementStatus(tx, target, targetStatus)
          : matching.find(({ listId }) => listId === target.listId);
        if (!selected) throw new ApiError(400, "That status must exist in every selected home list");
        const completed = isCompletedStatus(selected.type);
        await tx.task.updateMany({
          where: { id: target.id, deletedAt: null },
          data: { statusId: selected.id, ...(!completed && { completedAt: null }) },
        });
        if (completed) await tx.task.updateMany({
          where: { id: target.id, deletedAt: null, completedAt: null }, data: { completedAt: new Date() },
        });
      }
    }
    if (patch?.priority !== undefined) data.priority = patch.priority as Priority | null;
    if (patch?.dueDate !== undefined) data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
    if (patch?.archived !== undefined) {
      const changed = await tx.task.updateManyAndReturn({
        where: { id: { in: ids }, deletedAt: null, archived: !patch.archived },
        data: { archived: patch.archived }, select: { id: true },
      });
      if (changed.length) await tx.activity.createMany({
        data: changed.map(({ id }) => ({ taskId: id, userId: user.id, type: patch.archived ? "archived" : "unarchived" })),
      });
    }
    if (Object.keys(data).length || targetStatus || status || patch?.assigneeIds) await tx.activity.createMany({
      data: ids.map((taskId) => ({ taskId, userId: user.id, type: "bulk_updated", data: {
        ...(patch?.statusId && { statusId: patch.statusId }),
        ...(status && { status }),
        ...(patch?.priority !== undefined && { priority: patch.priority }),
        ...(patch?.dueDate !== undefined && { dueDate: patch.dueDate }),
        ...(patch?.assigneeIds && { assigneeIds: patch.assigneeIds }),
      } })),
    });
    if (Object.keys(data).length) await tx.task.updateMany({ where: { id: { in: ids }, deletedAt: null }, data });

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
