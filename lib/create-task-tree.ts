import { ApiError } from "@/lib/api-helpers";
import type { Prisma } from "@/lib/generated/prisma/client";

type NewTask = Prisma.TaskCreateManyInput & { id: string };

/** Each insert must see its parent so PostgreSQL can check inherited access. */
export async function createTaskTree(tx: Prisma.TransactionClient, tasks: NewTask[]) {
  const children = new Map<string, NewTask[]>();
  let level: NewTask[] = [];
  for (const task of tasks) {
    if (!task.parentId) {
      level.push(task);
      continue;
    }
    const siblings = children.get(task.parentId) ?? [];
    siblings.push(task);
    children.set(task.parentId, siblings);
  }

  let inserted = 0;
  while (level.length) {
    await tx.task.createMany({ data: level });
    inserted += level.length;
    level = level.flatMap(({ id }) => children.get(id) ?? []);
  }
  if (inserted !== tasks.length) throw new ApiError(400, "Invalid task hierarchy");
}
