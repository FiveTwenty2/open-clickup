import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

export type WorkspaceTaskFilters = {
  q: string;
  status: "all" | "open" | "closed" | "overdue";
  listId?: string;
  assignee?: string;
  sort: "due" | "updated" | "name";
  page: number;
};

export async function getWorkspaceTasks(workspaceId: string, filters: WorkspaceTaskFilters) {
  const where: Prisma.TaskWhereInput = {
    list: { space: { workspaceId }, archivedAt: null }, archived: false, deletedAt: null,
    ...(filters.listId && { listId: filters.listId }),
    ...(filters.q && { name: { contains: filters.q, mode: "insensitive" } }),
    ...(filters.assignee && { assignees: filters.assignee === "unassigned" ? { none: {} } : { some: { userId: filters.assignee } } }),
    ...(filters.status !== "all" && { status: { type: { in: filters.status === "closed" ? ["DONE", "CLOSED"] : ["NOT_STARTED", "ACTIVE"] } } }),
    ...(filters.status === "overdue" && { dueDate: { lt: new Date() } }),
  };
  const sort: Prisma.TaskOrderByWithRelationInput = filters.sort === "name"
    ? { name: "asc" } : filters.sort === "updated" ? { updatedAt: "desc" } : { dueDate: { sort: "asc", nulls: "last" } };
  const rows = await prisma.task.findMany({
    where,
    orderBy: [sort, { id: "asc" }],
    take: 51,
    skip: filters.page * 50,
    select: {
      id: true, name: true, listId: true, dueDate: true, priority: true, archived: true,
      status: { select: { id: true, name: true, color: true, type: true } },
      parent: { select: { name: true } },
      list: { select: { name: true, space: { select: { name: true } } } },
      assignees: { select: { user: { select: { id: true, name: true } } } },
    },
  });
  return { tasks: rows.slice(0, 50), hasNext: rows.length > 50 };
}
