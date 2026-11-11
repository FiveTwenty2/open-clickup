import type { TaskWithRelations } from "@/lib/queries";
import type { Priority } from "@/lib/enums";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { isCompletedStatus } from "@/lib/task-status";

export type SortField = "priority" | "dueDate" | "name" | "created" | null;
export type GroupBy = "status" | "assignee" | "priority" | "none";

export type ViewState = {
  filters: {
    priorities: Priority[];
    assignees: string[];
    tags: string[];
    completion?: "open" | "closed" | "all";
    due?: "overdue" | "week" | "none" | "all";
    assignment?: "unassigned" | "all";
    recurrence?: "recurring" | "all";
  };
  sort: { field: SortField; dir: "asc" | "desc" };
  groupBy: GroupBy;
  subtasks?: "collapsed" | "expanded" | "separate";
  hideClosedSubtasks?: boolean;
  statusIds?: string[];
};

export const EMPTY_VIEW_STATE: ViewState = {
  filters: { priorities: [], assignees: [], tags: [] },
  sort: { field: null, dir: "asc" },
  groupBy: "status",
};

export function countActiveFilters(vs: ViewState): number {
  return (
    vs.filters.priorities.length +
    vs.filters.assignees.length +
    vs.filters.tags.length +
    Number(!!vs.filters.completion && vs.filters.completion !== "all") +
    Number(!!vs.filters.due && vs.filters.due !== "all") +
    Number(vs.filters.assignment === "unassigned") +
    Number(vs.filters.recurrence === "recurring")
  );
}

export function applyViewState(
  tasks: TaskWithRelations[],
  vs: ViewState,
): TaskWithRelations[] {
  let out = tasks;
  const { priorities, assignees, tags, completion } = vs.filters;

  const statuses = new Set(vs.statusIds);
  if (statuses.size) out = out.filter((task) => statuses.has(task.statusId));
  if (completion && completion !== "all") {
    out = out.filter((task) => isCompletedStatus(task.status.type) === (completion === "closed"));
  }
  if (vs.filters.assignment === "unassigned") out = out.filter((task) => !task.assignees.length);
  if (vs.filters.recurrence === "recurring") out = out.filter((task) => !!task.recurrence);
  if (vs.filters.due && vs.filters.due !== "all") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    out = out.filter((task) => {
      if (vs.filters.due === "none") return !task.dueDate;
      if (!task.dueDate || isCompletedStatus(task.status.type)) return false;
      const due = new Date(task.dueDate);
      if (vs.filters.due === "overdue") return due < today;
      return due >= today && due < nextWeek;
    });
  }

  if (priorities.length) {
    const set = new Set(priorities);
    out = out.filter((t) => t.priority && set.has(t.priority));
  }
  if (assignees.length) {
    const set = new Set(assignees);
    out = out.filter((t) => t.assignees.some((a) => set.has(a.userId)));
  }
  if (tags.length) {
    const set = new Set(tags);
    out = out.filter((t) => t.tags.some((tg) => set.has(tg.tagId)));
  }

  if (vs.sort.field) {
    const dir = vs.sort.dir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => cmp(a, b, vs.sort.field!) * dir);
  }
  return out;
}

function cmp(a: TaskWithRelations, b: TaskWithRelations, field: SortField): number {
  switch (field) {
    case "priority": {
      const pa = a.priority ? PRIORITY_CONFIG[a.priority].order : 99;
      const pb = b.priority ? PRIORITY_CONFIG[b.priority].order : 99;
      return pa - pb;
    }
    case "dueDate": {
      const da = a.dueDate ? +new Date(a.dueDate) : Infinity;
      const db = b.dueDate ? +new Date(b.dueDate) : Infinity;
      return da - db;
    }
    case "name":
      return a.name.localeCompare(b.name);
    case "created":
      return +new Date(a.createdAt) - +new Date(b.createdAt);
    default:
      return 0;
  }
}
