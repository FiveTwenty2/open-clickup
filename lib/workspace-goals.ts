import { prisma } from "@/lib/db";
import { z } from "zod";

export const goalInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  target: z.number().int().positive().max(1_000_000_000),
  progress: z.number().int().nonnegative().max(1_000_000_000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

export async function listGoals(workspaceId: string, archived: boolean) {
  return prisma.workspaceGoal.findMany({
    where: { workspaceId, archived }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    include: {
      tasks: {
        where: { task: { deletedAt: null } },
        include: { task: { select: { id: true, name: true, listId: true, status: { select: { type: true, name: true } } } } },
      },
    },
  });
}
