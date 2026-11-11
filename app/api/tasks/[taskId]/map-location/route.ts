import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess, requireTaskInWorkspace } from "@/lib/integration-access";
import { readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Ctx = { params: Promise<{ taskId: string }> };
const schema = z.union([
  z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  z.object({ latitude: z.null(), longitude: z.null() }),
]);

export const PATCH = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true);
  const { listId } = await requireTaskInWorkspace(taskId, workspaceId);
  await requireResourcePermission("task", taskId, permissionLevels.EDIT);
  const { latitude, longitude } = await readJson(req, schema);
  const task = await prisma.task.update({
    where: { id: taskId, deletedAt: null, listId },
    data: { mapLatitude: latitude, mapLongitude: longitude },
    select: { id: true, mapLatitude: true, mapLongitude: true },
  });
  publish({ type: "list", listId });
  return NextResponse.json(task);
});
