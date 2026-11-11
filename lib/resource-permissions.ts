import { z } from "zod";
import { ApiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";

export const resourceKind = z.enum(["space", "folder", "list", "task"]);
export type ResourceKind = z.infer<typeof resourceKind>;
export const permissionLevels = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 } as const;

export async function requireResourcePermission(
  kind: ResourceKind, id: string, minimum: number, db: Pick<typeof prisma, "$queryRaw"> = prisma,
) {
  const [{ permission }] = await db.$queryRaw<[{ permission: number }]>`
    SELECT oc_acl(${kind}, ${id}) AS permission
  `;
  if (permission === 0) throw new ApiError(404, "Location not found");
  if (permission < minimum) throw new ApiError(403, "You do not have permission for this action");
  return permission;
}

export async function requireTaskBranchPermission(
  id: string, minimum: number, db: Pick<typeof prisma, "$queryRaw">,
) {
  const [{ permitted }] = await db.$queryRaw<[{ permitted: boolean }]>`
    SELECT oc_can_manage_task_branch(${id}, ${minimum}) AS permitted
  `;
  if (!permitted) throw new ApiError(403, "You do not have permission to change every task in this branch");
}

export async function requireWorkspaceExport(
  kind: ResourceKind, id: string, db: Pick<typeof prisma, "$queryRaw">,
) {
  await requireResourcePermission(kind, id, permissionLevels.FULL, db);
  const [{ permitted }] = await db.$queryRaw<[{ permitted: boolean }]>`
    SELECT oc_may_export(${kind}, ${id}) AS permitted
  `;
  if (!permitted) throw new ApiError(403, "Private items cannot be saved as workspace templates");
}

export async function requirePublicLocation(kind: ResourceKind, id: string, db: Pick<typeof prisma, "$queryRaw"> = prisma) {
  const [{ permitted }] = await db.$queryRaw<[{ permitted: boolean }]>`
    SELECT oc_is_workspace_visible(${kind}, ${id}) AS permitted
  `;
  if (!permitted) throw new ApiError(403, "Public links require a public location");
}

export async function requireResourceMove(
  kind: ResourceKind, id: string, destinationKind: ResourceKind, destinationId: string,
  db: Pick<typeof prisma, "$queryRaw">,
) {
  await requireResourcePermission(kind, id, permissionLevels.EDIT, db);
  await requireResourcePermission(destinationKind, destinationId, permissionLevels.EDIT, db);
  const [{ permitted }] = await db.$queryRaw<[{ permitted: boolean }]>`
    SELECT oc_move_keeps_privacy(${kind}, ${id}, ${destinationKind}, ${destinationId}) AS permitted
  `;
  if (!permitted) throw new ApiError(403, "Move this item within its private location");
}

export async function requireChecklistEdit(checklistId: string) {
  const checklist = await prisma.checklist.findFirst({
    where: { id: checklistId, task: { deletedAt: null } }, select: { taskId: true },
  });
  if (!checklist) throw new ApiError(404, "Checklist not found");
  await requireResourcePermission("task", checklist.taskId, permissionLevels.EDIT);
}
