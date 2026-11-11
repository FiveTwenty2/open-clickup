import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import { ApiError } from "@/lib/api-helpers";
import { equivalentStatus, isCompletedStatus } from "@/lib/task-status";
import { visibleSecondaryListIds } from "@/lib/task-placements";

export const workflowSchema = z.array(z.object({
  key: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  type: z.enum(["NOT_STARTED", "ACTIVE", "DONE", "CLOSED"]),
  wipLimit: z.number().int().positive().nullable().optional(),
})).min(1).max(100)
  .refine((items) => new Set(items.map((item) => item.key)).size === items.length, "Status identifiers must be unique")
  .refine((items) => new Set(items.map((item) => item.name.toLowerCase())).size === items.length, "Status names must be unique")
  .refine((items) => items.some((item) => !isCompletedStatus(item.type)), "Keep at least one open status");
export type StatusWorkflow = z.infer<typeof workflowSchema>;

export const DEFAULT_WORKFLOW: StatusWorkflow = [
  { key: "todo", name: "TO DO", color: "#87909e", type: "NOT_STARTED" },
  { key: "progress", name: "IN PROGRESS", color: "#5b9fff", type: "ACTIVE" },
  { key: "review", name: "IN REVIEW", color: "#a875ff", type: "ACTIVE" },
  { key: "complete", name: "COMPLETE", color: "#6bc950", type: "DONE" },
];

type Scope = { spaceId: string; folderId: string | null };
export async function lockWorkflows(tx: Prisma.TransactionClient, workspaceId: string) {
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
}

export async function workflowFor(tx: Prisma.TransactionClient, scope: Scope) {
  const [space, folders] = await Promise.all([
    tx.space.findUnique({ where: { id: scope.spaceId }, select: { statusWorkflow: true, name: true } }),
    tx.folder.findMany({ where: { spaceId: scope.spaceId }, select: { id: true, parentId: true, name: true, statusWorkflow: true } }),
  ]);
  if (!space) throw new ApiError(404, "Space not found");
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let folderId = scope.folderId;
  while (folderId) {
    const folder = byId.get(folderId);
    if (!folder) throw new ApiError(400, "Folder is outside this space");
    if (folder.statusWorkflow) return { workflow: workflowSchema.parse(folder.statusWorkflow), source: folder.name };
    folderId = folder.parentId;
  }
  return space.statusWorkflow
    ? { workflow: workflowSchema.parse(space.statusWorkflow), source: space.name }
    : { workflow: DEFAULT_WORKFLOW, source: "Default workflow" };
}

export function statusCreate(workflow: StatusWorkflow) {
  return workflow.map(({ key, ...status }, position) => ({
    ...status, position, inheritedKey: key, wipLimit: status.wipLimit ?? null,
  }));
}

export async function syncListWorkflow(tx: Prisma.TransactionClient, listId: string, workflow: StatusWorkflow) {
  await tx.$executeRaw`SELECT oc_apply_list_status_workflow(${listId}, ${JSON.stringify(workflow)}::jsonb)`;
}

export async function resolvePlacementStatus(tx: Prisma.TransactionClient, task: { id: string; listId: string }, statusId: string) {
  const selected = await tx.status.findFirst({ where: { id: statusId }, select: { id: true, listId: true, name: true, type: true } });
  if (!selected) throw new ApiError(400, "Choose a valid status");
  if (selected.listId === task.listId) return selected;
  if (!(await visibleSecondaryListIds(tx, task.id)).includes(selected.listId)) {
    throw new ApiError(400, "Choose a status from a list containing this task");
  }
  const statuses = await tx.status.findMany({ where: { listId: task.listId }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const equivalent = equivalentStatus(statuses, selected);
  if (!equivalent) throw new ApiError(400, "The home list has no equivalent status");
  return equivalent;
}
