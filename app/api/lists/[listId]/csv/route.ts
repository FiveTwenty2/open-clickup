import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route } from "@/lib/api-helpers";
import { requireIntegrationAccess, requireListInWorkspace } from "@/lib/integration-access";
import { exportListCsv, importListCsv } from "@/lib/list-csv";

type Ctx = { params: Promise<{ listId: string }> };

export const GET = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req);
  await requireListInWorkspace(listId, workspaceId);
  const csv = await exportListCsv(listId);
  return new NextResponse("\uFEFF" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="open-clickup-tasks.csv"', "Cache-Control": "no-store" },
  });
});

export const POST = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId, user } = await requireIntegrationAccess(req, true);
  await requireListInWorkspace(listId, workspaceId);
  const { csv, preview } = await readJson(req, z.object({ csv: z.string().min(1).max(2_000_000), preview: z.boolean().default(true) }));
  const result = await importListCsv(workspaceId, listId, user.id, csv, preview);
  return NextResponse.json(result, { status: result.imported ? 201 : 200 });
});
