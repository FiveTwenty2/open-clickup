import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, route, readJson } from "@/lib/api-helpers";
import { requireRole } from "@/lib/permissions";
import { readDocument } from "@/lib/workspace-documents";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, { params }: Ctx) => {
  const { id } = await params;
  const { workspaceId } = await requireRole("GUEST");
  const document = await readDocument(workspaceId, id);
  if (!document) throw new ApiError(404, "Document not found");
  return NextResponse.json(document);
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const { id } = await params;
  const { workspaceId } = await requireRole("MEMBER");
  const { revision, ...changes } = await readJson(req, z.object({
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(160).optional(),
    body: z.string().max(200_000).optional(),
    archived: z.boolean().optional(),
  }));
  const document = await readDocument(workspaceId, id);
  if (!document) throw new ApiError(404, "Document not found");
  const result = await prisma.workspaceDocument.updateMany({
    where: { id, workspaceId, revision },
    data: { ...changes, revision: { increment: 1 } },
  });
  if (!result.count) throw new ApiError(409, "This document was edited by someone else");
  publish({ type: "docs" });
  return NextResponse.json(await readDocument(workspaceId, id));
});
