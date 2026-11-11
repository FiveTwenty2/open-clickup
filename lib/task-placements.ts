import type { Prisma } from "@/lib/generated/prisma/client";

/** Follow the canonical task tree from each explicitly placed task through visible descendants. */
export async function visibleSecondaryTaskIds(
  db: Pick<Prisma.TransactionClient, "$queryRaw">, listId: string, exceptRoot?: string,
) {
  return visibleSecondaryTaskIdsForLists(db, [listId], { exceptRoot });
}

export async function visibleSecondaryTaskIdsForLists(
  db: Pick<Prisma.TransactionClient, "$queryRaw">, listIds: string[],
  { exceptRoot, publicView = false }: { exceptRoot?: string; publicView?: boolean } = {},
) {
  if (!listIds.length) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE placed(id, home_id) AS (
      SELECT t.id, t."listId"
      FROM "TaskListMembership" m
      JOIN "Task" t ON t.id = m."taskId"
      LEFT JOIN "List" h ON h.id = t."listId"
      JOIN "List" d ON d.id = m."listId"
      LEFT JOIN "Space" hs ON hs.id = h."spaceId"
      LEFT JOIN "Space" ds ON ds.id = d."spaceId"
      WHERE m."listId" = ANY(${listIds}::text[]) AND m.explicit AND d."archivedAt" IS NULL
        AND (${publicView} OR (h."archivedAt" IS NULL AND hs."workspaceId" = ds."workspaceId"))
        AND t."deletedAt" IS NULL AND NOT t.archived
        AND (${exceptRoot ?? null}::text IS NULL OR t.id <> ${exceptRoot ?? null})
      UNION
      SELECT t.id, t."listId" FROM "Task" t
      JOIN placed p ON t."parentId" = p.id AND t."listId" = p.home_id
      WHERE t."deletedAt" IS NULL AND NOT t.archived
    )
    SELECT id FROM placed
  `;
  return rows.map(({ id }) => id);
}

export async function visibleSecondaryListIds(db: Pick<Prisma.TransactionClient, "$queryRaw">, taskId: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors(id, home_id, parent_id) AS (
      SELECT t.id, t."listId", t."parentId" FROM "Task" t
      JOIN "List" l ON l.id = t."listId"
      WHERE t.id = ${taskId} AND t."deletedAt" IS NULL AND NOT t.archived AND l."archivedAt" IS NULL
      UNION
      SELECT t.id, t."listId", t."parentId" FROM "Task" t
      JOIN ancestors a ON t.id = a.parent_id AND t."listId" = a.home_id
      WHERE t."deletedAt" IS NULL AND NOT t.archived
    )
    SELECT DISTINCT l.id FROM ancestors a
    JOIN "TaskListMembership" m ON m."taskId" = a.id AND m.explicit
    JOIN "List" l ON l.id = m."listId" AND l."archivedAt" IS NULL
    JOIN "List" h ON h.id = a.home_id
    JOIN "Space" hs ON hs.id = h."spaceId"
    JOIN "Space" ds ON ds.id = l."spaceId" AND ds."workspaceId" = hs."workspaceId"
  `;
  return rows.map(({ id }) => id);
}
