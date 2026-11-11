import { prisma } from "@/lib/db";
import type { Priority } from "@/lib/generated/prisma/client";

type TaskValues = { priority?: Priority | null; dueDate?: string | null; assigneeIds: string[] };

/** One pass per user/API mutation. Rules never change the triggering status. */
export async function applyTaskAutomations(
  listId: string, trigger: "CREATED" | "STATUS_CHANGED", statusId: string, values: TaskValues,
): Promise<TaskValues> {
  const rules = await prisma.taskAutomation.findMany({
    where: { listId, enabled: true, trigger, ...(trigger === "STATUS_CHANGED" && { statusId }) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!rules.length) return values;
  const candidates = rules.flatMap((rule) => rule.assigneeId ? [rule.assigneeId] : []);
  const list = candidates.length ? await prisma.list.findUnique({ where: { id: listId }, select: { space: { select: { workspaceId: true } } } }) : null;
  const members = list ? await prisma.workspaceMember.findMany({
    where: { workspaceId: list.space.workspaceId, userId: { in: candidates } }, select: { userId: true },
  }) : [];
  const memberIds = new Set(members.map((member) => member.userId));
  const assigneeIds = new Set(values.assigneeIds);
  let { priority, dueDate } = values;
  for (const rule of rules) {
    if (rule.priority) priority = rule.priority;
    if (rule.dueDays !== null && !dueDate) dueDate = new Date(Date.now() + rule.dueDays * 86_400_000).toISOString();
    if (rule.assigneeId && memberIds.has(rule.assigneeId)) assigneeIds.add(rule.assigneeId);
  }
  return { priority, dueDate, assigneeIds: [...assigneeIds] };
}
