import { NextResponse } from "next/server";
import { route } from "@/lib/api-helpers";
import { requireIntegrationAccess } from "@/lib/integration-access";

export const GET = route(async (req) => {
  const { user, role, workspaceId } = await requireIntegrationAccess(req);
  const { id, name, email } = user;
  return NextResponse.json({ id, name, email, role, workspaceId });
});
