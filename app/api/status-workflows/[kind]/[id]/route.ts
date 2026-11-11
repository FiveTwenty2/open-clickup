import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { lockWorkflows, syncListWorkflow, workflowFor, workflowSchema } from "@/lib/status-workflows";
import { Prisma } from "@/lib/generated/prisma/client";
import { publish } from "@/lib/events";
import type { StatusWorkflow } from "@/lib/status-workflows";
import { permissionLevels, requireResourcePermission } from "@/lib/resource-permissions";

type Context = { params: Promise<{ kind: string; id: string }> };
type Kind = "space" | "folder" | "list";
const isKind = (kind: string): kind is Kind => kind === "space" || kind === "folder" || kind === "list";

async function location(tx: Prisma.TransactionClient, kind: Kind, id: string, workspaceId: string) {
  if (kind === "space") {
    const space = await tx.space.findFirst({ where: { id, workspaceId }, select: { statusWorkflow: true } });
    if (!space) throw new ApiError(404, "Space not found");
    return { spaceId: id, folderId: null, own: space.statusWorkflow, inherited: !space.statusWorkflow };
  }
  if (kind === "folder") {
    const folder = await tx.folder.findFirst({ where: { id, space: { workspaceId } }, select: { spaceId: true, statusWorkflow: true } });
    if (!folder) throw new ApiError(404, "Folder not found");
    return { spaceId: folder.spaceId, folderId: id, own: folder.statusWorkflow, inherited: !folder.statusWorkflow };
  }
  const list = await tx.list.findFirst({ where: { id, space: { workspaceId } }, select: { spaceId: true, folderId: true, inheritStatuses: true } });
  if (!list) throw new ApiError(404, "List not found");
  return { spaceId: list.spaceId, folderId: list.folderId, own: null, inherited: list.inheritStatuses };
}

export const GET = route(async (req, { params }: Context) => {
  const { kind, id } = await params;
  if (!isKind(kind)) throw new ApiError(404, "Location not found");
  const { workspaceId } = await requireIntegrationAccess(req);
  await requireResourcePermission(kind, id, permissionLevels.VIEW);
  const scope = await location(prisma, kind, id, workspaceId);
  if (kind === "list" && !scope.inherited) {
    const statuses = await prisma.status.findMany({ where: { listId: id }, orderBy: [{ position: "asc" }, { id: "asc" }] });
    return NextResponse.json({
      inherited: false, source: "List workflow",
      workflow: statuses.map(({ id, name, color, type, wipLimit }) => ({ key: id, name, color, type, wipLimit })),
    });
  }
  return NextResponse.json({ ...await workflowFor(prisma, scope), inherited: scope.inherited });
});

export const PUT = route(async (req, { params }: Context) => {
  const { kind, id } = await params;
  if (!isKind(kind)) throw new ApiError(404, "Location not found");
  const { workspaceId, role } = await requireIntegrationAccess(req, true, true);
  if (kind !== "list" && role !== "OWNER" && role !== "ADMIN") {
    throw new ApiError(403, "Only workspace owners and admins can change shared workflows");
  }
  const { workflow } = await readJson(req, z.object({ workflow: workflowSchema.nullable() }));
  await prisma.$transaction(async (tx) => {
    await requireResourcePermission(kind, id, permissionLevels.EDIT, tx);
    await lockWorkflows(tx, workspaceId);
    const scope = await location(tx, kind, id, workspaceId);
    if (kind === "list") {
      const next: StatusWorkflow = workflow ?? (await workflowFor(tx, scope)).workflow;
      await syncListWorkflow(tx, id, next);
      await tx.list.update({ where: { id }, data: { inheritStatuses: workflow === null } });
      return;
    }
    const statusWorkflow = workflow ?? Prisma.DbNull;
    if (kind === "space") await tx.space.update({ where: { id }, data: { statusWorkflow } });
    else await tx.folder.update({ where: { id }, data: { statusWorkflow } });
  }, { timeout: 60000 });
  if (kind === "list") publish({ type: "list", listId: id });
  publish({ type: "bootstrap" });
  return NextResponse.json({ ok: true });
});
