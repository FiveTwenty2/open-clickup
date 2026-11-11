import { NextResponse } from "next/server";
import { requireIntegrationAccess, requireListInWorkspace, requireWorkspaceUsers } from "@/lib/integration-access";
import { getDashboard } from "@/lib/dashboard";
import { ApiError, route } from "@/lib/api-helpers";

export const GET = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req);
  const params = new URL(req.url).searchParams;
  const now = new Date();
  const from = new Date(params.get("from") ?? now.getTime() - 7 * 86_400_000);
  const to = new Date(params.get("to") ?? now.getTime());
  const elapsed = to.getTime() - from.getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 366 * 86_400_000) {
    throw new ApiError(400, "Choose a reporting period of up to one year");
  }
  const listId = params.get("listId") || undefined;
  const userId = params.get("userId") || undefined;
  if (listId) await requireListInWorkspace(listId, workspaceId);
  if (userId) await requireWorkspaceUsers(workspaceId, [userId]);
  return NextResponse.json(await getDashboard(workspaceId, { from, to, listId, userId }));
});
