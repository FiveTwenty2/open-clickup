import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { lockWorkflows, syncListWorkflow, workflowFor } from "@/lib/status-workflows";
import { publish } from "@/lib/events";
import { permissionLevels, requireResourceMove, requireResourcePermission } from "@/lib/resource-permissions";
import { midpoint } from "@/lib/utils";

const kind = z.enum(["space", "folder", "list"]);
const item = z.object({ kind, id: z.string().min(1) });
const schema = z.object({ source: item, target: item, placement: z.enum(["before", "after", "inside"]) });
const order = [{ position: "asc" }, { id: "asc" }] as const;

function rankChanges(rows: { id: string; position: number }[], source: string, target: string, placement: "before" | "after" | "inside") {
  const siblings = rows.filter((row) => row.id !== source);
  const index = placement === "inside" ? siblings.length : siblings.findIndex((row) => row.id === target) + Number(placement === "after");
  const previous = siblings[index - 1]?.position ?? null;
  const next = siblings[index]?.position ?? null;
  const position = midpoint(previous, next);
  if (Number.isFinite(position) && (previous === null || position > previous) && (next === null || position < next)) {
    return [{ id: source, position }];
  }
  siblings.splice(index, 0, { id: source, position });
  return siblings.flatMap((row, i) => {
    const rank = (i + 1) * 1000;
    return row.id === source || row.position !== rank ? [{ id: row.id, position: rank }] : [];
  });
}

export const POST = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req, true, true);
  const { source, target, placement } = await readJson(req, schema);
  if (source.id === target.id) return NextResponse.json({ ok: true });
  await prisma.$transaction(async (tx) => {
    await lockWorkflows(tx, workspaceId);
    const select = { id: true, position: true } as const;
    if (source.kind === "space" && target.kind === "space" && placement !== "inside") {
      const spaces = await tx.space.findMany({ where: { workspaceId }, select, orderBy: [...order] });
      if (!spaces.some((row) => row.id === source.id) || !spaces.some((row) => row.id === target.id)) throw new ApiError(404, "Space not found");
      for (const { id, position } of rankChanges(spaces, source.id, target.id, placement)) {
        await requireResourcePermission("space", id, permissionLevels.EDIT, tx);
        await tx.space.update({ where: { id }, data: { position } });
      }
      return;
    }
    if (source.kind === "folder" && target.kind === "folder" && placement !== "inside") {
      const folder = await tx.folder.findFirst({ where: { id: source.id, space: { workspaceId } }, select: { spaceId: true, parentId: true } });
      if (!folder) throw new ApiError(404, "Folder not found");
      const folders = await tx.folder.findMany({ where: { spaceId: folder.spaceId, parentId: folder.parentId }, select, orderBy: [...order] });
      if (!folders.some((row) => row.id === target.id)) throw new ApiError(400, "Reorder folders with the same parent");
      for (const { id, position } of rankChanges(folders, source.id, target.id, placement)) {
        await requireResourcePermission("folder", id, permissionLevels.EDIT, tx);
        await tx.folder.update({ where: { id }, data: { position } });
      }
      return;
    }
    if (source.kind !== "list") throw new ApiError(400, "Choose a compatible destination");
    const list = await tx.list.findFirst({ where: { id: source.id, archivedAt: null, space: { workspaceId } }, select: { spaceId: true, folderId: true, inheritStatuses: true } });
    if (!list) throw new ApiError(404, "List not found");
    let destination: { spaceId: string; folderId: string | null } | null = null;
    if (target.kind === "list" && placement !== "inside") destination = await tx.list.findFirst({
      where: { id: target.id, archivedAt: null, space: { workspaceId } }, select: { spaceId: true, folderId: true },
    });
    if (target.kind === "folder" && placement === "inside") {
      const folder = await tx.folder.findFirst({ where: { id: target.id, space: { workspaceId } }, select: { id: true, spaceId: true } });
      if (folder) destination = { spaceId: folder.spaceId, folderId: folder.id };
    }
    if (target.kind === "space" && placement === "inside") {
      const space = await tx.space.findFirst({ where: { id: target.id, workspaceId }, select: { id: true } });
      if (space) destination = { spaceId: space.id, folderId: null };
    }
    if (!destination) throw new ApiError(404, "Destination not found");
    const changedParent = list.spaceId !== destination.spaceId || list.folderId !== destination.folderId;
    if (changedParent) {
      await requireResourceMove("list", source.id, destination.folderId ? "folder" : "space", destination.folderId ?? destination.spaceId, tx);
    }
    const siblings = await tx.list.findMany({ where: { ...destination, archivedAt: null }, select, orderBy: [...order] });
    if (destination.spaceId !== list.spaceId) {
      await tx.taskTag.deleteMany({ where: { task: { listId: source.id }, tag: { spaceId: { not: destination.spaceId } } } });
    }
    for (const { id, position } of rankChanges(siblings, source.id, target.id, placement)) {
      if (!changedParent || id !== source.id) await requireResourcePermission("list", id, permissionLevels.EDIT, tx);
      await tx.list.update({ where: { id }, data: { position, ...(changedParent && id === source.id && destination) } });
    }
    if (list.inheritStatuses && changedParent) {
      const { workflow } = await workflowFor(tx, destination);
      await syncListWorkflow(tx, source.id, workflow);
    }
  });
  publish({ type: "bootstrap" });
  if (source.kind === "list") publish({ type: "list", listId: source.id });
  return NextResponse.json({ ok: true });
});
