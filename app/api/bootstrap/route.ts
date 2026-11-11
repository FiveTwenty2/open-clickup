import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getWorkspaceTree } from "@/lib/queries";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { route, ApiError } from "@/lib/api-helpers";

export const GET = route(async (req) => {
  const { user, workspaceId } = await requireIntegrationAccess(req);

  const workspace = await getWorkspaceTree(workspaceId);
  if (!workspace) throw new ApiError(404, "No workspace found");

  const favorites = await prisma.favorite.findMany({
    where: { userId: user.id, list: { space: { workspaceId } } },
    select: { listId: true },
  });

  // never leak passwordHash to the client
  const currentUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    color: user.color,
    avatarUrl: user.avatarUrl,
  };
  return NextResponse.json({ currentUser, workspace, favorites: favorites.map((f) => f.listId) });
});
