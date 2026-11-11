import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

export async function getDashboard(workspaceId: string, range: { from: Date; to: Date; userId?: string; listId?: string }) {
  const scope: Prisma.TaskWhereInput = {
    list: { space: { workspaceId } },
    ...(range.listId && { listId: range.listId }),
  };
  const active: Prisma.TaskWhereInput = {
    ...scope, archived: false, deletedAt: null,
    ...(range.userId && { assignees: { some: { userId: range.userId } } }),
  };
  const open: Prisma.TaskWhereInput = { ...active, status: { type: { in: ["ACTIVE", "NOT_STARTED"] } } };
  const overdue: Prisma.TaskWhereInput = { ...open, dueDate: { lt: new Date() } };
  const logged: Prisma.TimeEntryWhereInput = {
    task: scope,
    endedAt: { not: null },
    startedAt: { gte: range.from, lt: range.to },
    ...(range.userId && { userId: range.userId }),
  };
  const [openCount, closedCount, overdueCount, unassignedCount, upcoming, lists, entries, total] = await Promise.all([
    prisma.task.count({ where: open }),
    prisma.task.count({ where: { ...active, status: { type: { in: ["DONE", "CLOSED"] } } } }),
    prisma.task.count({ where: overdue }),
    prisma.task.count({ where: { ...open, assignees: { none: {} } } }),
    prisma.task.findMany({
      where: { ...open, dueDate: { not: null } },
      take: 20, orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      select: { id: true, name: true, dueDate: true, listId: true, list: { select: { name: true } } },
    }),
    prisma.task.groupBy({ by: ["listId", "statusId"], where: active, _count: { _all: true } }),
    prisma.timeEntry.groupBy({ by: ["userId"], where: logged, _sum: { duration: true }, _count: { _all: true } }),
    prisma.timeEntry.aggregate({ where: logged, _sum: { duration: true } }),
  ]);
  const statuses = lists.length ? await prisma.status.findMany({
    where: { id: { in: [...new Set(lists.map((entry) => entry.statusId))] } },
    select: { id: true, type: true },
  }) : [];
  const statusTypes = new Map(statuses.map((status) => [status.id, status.type]));
  const byList = new Map<string, { listId: string; open: number; closed: number }>();
  for (const row of lists) {
    const count = byList.get(row.listId) ?? { listId: row.listId, open: 0, closed: 0 };
    if (["DONE", "CLOSED"].includes(statusTypes.get(row.statusId) ?? "")) count.closed += row._count._all;
    else count.open += row._count._all;
    byList.set(row.listId, count);
  }
  return {
    openCount, closedCount, overdueCount, unassignedCount, upcoming,
    lists: [...byList.values()].sort((a, b) => b.open - a.open || b.closed - a.closed),
    timeByUser: entries.map((row) => ({ userId: row.userId, seconds: row._sum.duration ?? 0, entries: row._count._all }))
      .sort((a, b) => b.seconds - a.seconds),
    trackedSeconds: total._sum.duration ?? 0,
  };
}
