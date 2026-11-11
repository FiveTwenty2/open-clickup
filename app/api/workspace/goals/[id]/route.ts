import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readJson, route, ApiError } from "@/lib/api-helpers";
import { requireRole } from "@/lib/permissions";
import { requireTaskInWorkspace } from "@/lib/integration-access";
import { goalInput } from "@/lib/workspace-goals";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req, { params }: Ctx) => {
  const { id } = await params;
  const { workspaceId } = await requireRole("MEMBER");
  const { addTaskId, removeTaskId, ...data } = await readJson(req, goalInput.partial().extend({
    archived: z.boolean().optional(),
    addTaskId: z.string().min(1).optional(),
    removeTaskId: z.string().min(1).optional(),
  }));
  if (addTaskId && addTaskId === removeTaskId) throw new ApiError(400, "Choose one action for this task");
  if (addTaskId) await requireTaskInWorkspace(addTaskId, workspaceId);
  const goal = await prisma.$transaction(async (tx) => {
    const result = await tx.workspaceGoal.update({ where: { id, workspaceId }, data });
    if (addTaskId) await tx.goalTask.createMany({ data: [{ goalId: id, taskId: addTaskId }], skipDuplicates: true });
    if (removeTaskId) await tx.goalTask.deleteMany({ where: { goalId: id, taskId: removeTaskId } });
    return result;
  });
  publish({ type: "goals" });
  return NextResponse.json(goal);
});
