import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route } from "@/lib/api-helpers";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { getRecoveryTasks, restoreTask } from "@/lib/task-recovery";

export const GET = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req);
  const params = new URL(req.url).searchParams;
  const mode = params.get("mode") === "trash" ? "trash" : "archive";
  const page = Math.min(10_000, Math.max(0, Number.parseInt(params.get("page") ?? "0", 10) || 0));
  return NextResponse.json(await getRecoveryTasks(workspaceId, mode, page, params.get("q")?.trim().slice(0, 150)));
});

export const POST = route(async (req) => {
  const { workspaceId, user } = await requireIntegrationAccess(req, true);
  const { id } = await readJson(req, z.object({ id: z.string().min(1) }));
  await restoreTask(workspaceId, id, user.id);
  return NextResponse.json({ ok: true });
});
