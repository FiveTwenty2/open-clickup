import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { taskInclude } from "@/lib/queries";
import { ApiError, route } from "@/lib/api-helpers";
import { applyViewState } from "@/lib/view-state";
import { savedViewConfig } from "@/lib/saved-view-config";
import { isCompletedStatus } from "@/lib/task-status";
import { getPublicScopedViewTasks, getViewDependencies } from "@/lib/scoped-views";
import { setPublicAccess } from "@/lib/access-context";
import { visibleSecondaryTaskIdsForLists } from "@/lib/task-placements";

type Context = { params: Promise<{ key: string }> };

export const GET = route(async (_req, { params }: Context) => {
  const { key } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(key)) throw new ApiError(404, "Shared view not found");
  setPublicAccess("view", key);
  const listWhere = { key, view: { privateOwnerId: null, list: { archivedAt: null } } };
  const scopedWhere = { key, view: { privateOwnerId: null } };
  const link = await prisma.viewPublicLink.findFirst({
    where: listWhere, select: { view: { select: { name: true, config: true, listId: true, type: true } } },
  });
  const scoped = link ? null : await prisma.scopedViewPublicLink.findFirst({
    where: scopedWhere,
    select: { view: { select: { name: true, config: true, workspaceId: true, spaceId: true, folderId: true, type: true } } },
  });
  const view = link?.view ?? scoped?.view;
  if (!view) throw new ApiError(404, "Shared view not found");
  const config = savedViewConfig.safeParse(view.config ?? {});
  if (!config.success) throw new ApiError(404, "Shared view is unavailable");
  const state = config.data;
  const secondaryIds = link && view.type !== "EMBED"
    ? await visibleSecondaryTaskIdsForLists(prisma, [link.view.listId], { publicView: true }) : [];
  const rows = view.type === "EMBED" ? [] : link ? await prisma.task.findMany({
    where: { deletedAt: null, archived: false,
      OR: [{ listId: link.view.listId }, { id: { in: secondaryIds } }] },
    orderBy: [{ position: "asc" }, { id: "asc" }], include: taskInclude,
  }) : await getPublicScopedViewTasks(scoped!.view);
  const includeChildren = state.subtasks ? state.subtasks !== "collapsed" : view.type === "MIND_MAP" || view.type === "CALENDAR";
  const visible = applyViewState(rows.filter((row) => includeChildren || !row.parentId), state)
    .filter((task) => !state.hideClosedSubtasks || !task.parentId || !isCompletedStatus(task.status.type));
  const visibleIds = new Set(visible.map(({ id }) => id));
  const tasks = visible
    .map(({ id, parentId, name, priority, milestone, startDate, dueDate, status, mapLatitude, mapLongitude, assignees }) => ({
      id, parentId: parentId && visibleIds.has(parentId) ? parentId : null,
      name, priority, milestone, startDate, dueDate, status: { name: status.name, color: status.color, type: status.type },
      ...(view.type === "MAP" && { mapLatitude, mapLongitude }),
      ...((view.type === "TEAM" || state.groupBy === "assignee") && { assigned: assignees.length > 0 }),
    }));
  const active = link
    ? await prisma.viewPublicLink.findFirst({ where: listWhere, select: { viewId: true } })
    : await prisma.scopedViewPublicLink.findFirst({ where: scopedWhere, select: { viewId: true } });
  if (!active) throw new ApiError(404, "Shared view not found");
  const dependencies = view.type === "GANTT" ? await getViewDependencies(tasks.map(({ id }) => id)) : undefined;
  return NextResponse.json({ name: view.name, type: view.type, tasks, dependencies, groupBy: state.groupBy,
    ...(view.type === "EMBED" && { embedUrl: state.embedUrl }),
    ...(view.type === "MIND_MAP" && { mindMap: state.mindMap }),
  }, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" },
  });
});
