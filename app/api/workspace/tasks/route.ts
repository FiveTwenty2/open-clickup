import { NextResponse } from "next/server";
import { z } from "zod";
import { requireIntegrationAccess, requireListInWorkspace, requireWorkspaceUsers } from "@/lib/integration-access";
import { ApiError, route } from "@/lib/api-helpers";
import { getWorkspaceTasks } from "@/lib/workspace-tasks";

const filters = z.object({
  q: z.string().trim().max(200).default(""),
  status: z.enum(["all", "open", "closed", "overdue"]).default("all"),
  listId: z.string().min(1).optional(),
  assignee: z.string().min(1).optional(),
  sort: z.enum(["due", "updated", "name"]).default("due"),
  page: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const GET = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req);
  const result = filters.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!result.success) throw new ApiError(400, "Invalid task filter");
  const selection = result.data;
  if (selection.listId) await requireListInWorkspace(selection.listId, workspaceId);
  if (selection.assignee && selection.assignee !== "unassigned") await requireWorkspaceUsers(workspaceId, [selection.assignee]);
  return NextResponse.json(await getWorkspaceTasks(workspaceId, selection));
});
