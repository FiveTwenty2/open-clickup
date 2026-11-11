import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, readJson } from "@/lib/api-helpers";
import { requireRole } from "@/lib/permissions";
import { listDocuments } from "@/lib/workspace-documents";
import { publish } from "@/lib/events";

export const GET = route(async (req) => {
  const { workspaceId } = await requireRole("GUEST");
  return NextResponse.json(await listDocuments(workspaceId, new URL(req.url).searchParams.get("archived") === "true"));
});

export const POST = route(async (req) => {
  const { workspaceId } = await requireRole("MEMBER");
  const { title } = await readJson(req, z.object({ title: z.string().trim().min(1).max(160) }));
  const document = await prisma.workspaceDocument.create({ data: { workspaceId, title } });
  publish({ type: "docs" });
  return NextResponse.json(document, { status: 201 });
});
