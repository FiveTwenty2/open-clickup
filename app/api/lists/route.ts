import { NextResponse } from "next/server";
import { z } from "zod";
import { createListWithDefaults, validateListLocation } from "@/lib/hierarchy";
import { requireRole } from "@/lib/permissions";
import { readJson, route } from "@/lib/api-helpers";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

const schema = z.object({
  spaceId: z.string().min(1),
  folderId: z.string().nullish(),
  name: z.string().trim().min(1, "name is required"),
});

export const POST = route(async (req) => {
  const { workspaceId } = await requireRole("GUEST");
  const { spaceId, folderId, name } = await readJson(req, schema);
  await validateListLocation(workspaceId, spaceId, folderId);
  await requireResourcePermission(folderId ? "folder" : "space", folderId ?? spaceId, permissionLevels.EDIT);
  const list = await createListWithDefaults({ workspaceId, spaceId, folderId: folderId ?? null, name });
  return NextResponse.json(list, { status: 201 });
});
