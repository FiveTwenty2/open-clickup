import { ApiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";
import { ViewType } from "@/lib/generated/prisma/client";

import { DEFAULT_WORKFLOW, lockWorkflows, statusCreate, workflowFor } from "@/lib/status-workflows";
export const STATUS_TEMPLATE = DEFAULT_WORKFLOW.map(({ name, color, type }) => ({ name, color, type }));

const DEFAULT_VIEWS = [
  { name: "List", type: ViewType.LIST },
  { name: "Board", type: ViewType.BOARD },
  { name: "Calendar", type: ViewType.CALENDAR },
  { name: "Gantt", type: ViewType.GANTT },
  { name: "Table", type: ViewType.TABLE },
];

export async function validateListLocation(workspaceId: string, spaceId: string, folderId?: string | null) {
  const space = await prisma.space.findFirst({
    where: { id: spaceId, workspaceId, ...(folderId && { folders: { some: { id: folderId } } }) },
    select: { id: true },
  });
  if (!space) throw new ApiError(404, "List location not found");
}

const LIST_COLORS = ["#7b68ee", "#fd71af", "#ff7800", "#2ecd6f", "#0ab1e8", "#9b59b6"];

/** Create a list with the default status workflow + the five views. */
export async function createListWithDefaults(opts: {
  workspaceId: string;
  spaceId: string;
  folderId?: string | null;
  name: string;
}) {
  return prisma.$transaction(async (tx) => {
    await lockWorkflows(tx, opts.workspaceId);
    const count = await tx.list.count({ where: { spaceId: opts.spaceId } });
    const folderId = opts.folderId ?? null;
    const last = await tx.list.aggregate({ where: { spaceId: opts.spaceId, folderId }, _max: { position: true } });
    const { workflow } = await workflowFor(tx, { spaceId: opts.spaceId, folderId });
    return tx.list.create({
      data: {
        spaceId: opts.spaceId, folderId, name: opts.name, inheritStatuses: true,
        color: LIST_COLORS[count % LIST_COLORS.length],
        position: (last._max.position ?? 0) + 1000,
        statuses: { create: statusCreate(workflow) },
        views: { create: DEFAULT_VIEWS.map((view, position) => ({ ...view, position })) },
      },
    });
  });
}
