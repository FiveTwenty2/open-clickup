import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { taskInclude } from "@/lib/queries";
import { ApiError, route } from "@/lib/api-helpers";
import { applyViewState, EMPTY_VIEW_STATE } from "@/lib/view-state";
import { isCompletedStatus } from "@/lib/task-status";

type Context = { params: Promise<{ key: string }> };
const configSchema = z.object({
  filters: z.object({
    priorities: z.array(z.enum(["URGENT", "HIGH", "NORMAL", "LOW"])).default([]),
    assignees: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    completion: z.enum(["open", "closed", "all"]).optional(),
    due: z.enum(["overdue", "week", "none", "all"]).optional(),
    assignment: z.enum(["unassigned", "all"]).optional(),
    recurrence: z.enum(["recurring", "all"]).optional(),
  }).default(EMPTY_VIEW_STATE.filters),
  sort: z.object({ field: z.enum(["priority", "dueDate", "name", "created"]).nullable(), dir: z.enum(["asc", "desc"]) }).default(EMPTY_VIEW_STATE.sort),
  groupBy: z.enum(["none", "status", "priority", "assignee"]).default("status"),
  subtasks: z.enum(["collapsed", "expanded", "separate"]).optional(),
  statusIds: z.array(z.string()).optional(),
  hideClosedSubtasks: z.boolean().optional(),
});

export const GET = route(async (_req, { params }: Context) => {
  const { key } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(key)) throw new ApiError(404, "Shared view not found");
  const where = { key, view: { privateOwnerId: null, type: { in: ["LIST", "TABLE"] as ("LIST" | "TABLE")[] }, list: { archivedAt: null } } };
  const link = await prisma.viewPublicLink.findFirst({
    where, select: { view: { select: { name: true, config: true, listId: true } } },
  });
  if (!link) throw new ApiError(404, "Shared view not found");
  const config = configSchema.safeParse(link.view.config ?? {});
  if (!config.success) throw new ApiError(404, "Shared view is unavailable");
  const state = config.data;
  const rows = await prisma.task.findMany({
    where: {
      listId: link.view.listId, deletedAt: null, archived: false,
      list: { archivedAt: null },
      ...(state.subtasks !== "separate" && { parentId: null }),
    },
    orderBy: [{ position: "asc" }, { id: "asc" }], include: taskInclude,
  });
  const tasks = applyViewState(rows, state)
    .filter((task) => !state.hideClosedSubtasks || !task.parentId || !isCompletedStatus(task.status.type))
    .map(({ id, name, priority, milestone, startDate, dueDate, status }) => ({
      id, name, priority, milestone, startDate, dueDate, status: { name: status.name, color: status.color },
    }));
  // Check again after loading task data so a link revoked while this request was running stops serving it.
  if (!await prisma.viewPublicLink.findFirst({ where, select: { viewId: true } })) throw new ApiError(404, "Shared view not found");
  return NextResponse.json({ name: link.view.name, tasks }, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" },
  });
});
