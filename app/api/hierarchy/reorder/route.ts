import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";

const kind = z.enum(["space", "folder", "list"]);
const item = z.object({ kind, id: z.string().min(1) });
const schema = z.object({ source: item, target: item, placement: z.enum(["before", "after", "inside"]) });
const order = [{ position: "asc" }, { id: "asc" }] as const;

function ranked(rows: { id: string }[], source: string, target: string, placement: "before" | "after" | "inside") {
  const ids = rows.map((row) => row.id).filter((id) => id !== source);
  const index = placement === "inside" ? ids.length : ids.indexOf(target) + Number(placement === "after");
  ids.splice(index, 0, source);
  return ids;
}

export const POST = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req, true);
  const { source, target, placement } = await readJson(req, schema);
  if (source.id === target.id) return NextResponse.json({ ok: true });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    const select = { id: true, position: true } as const;
    if (source.kind === "space" && target.kind === "space" && placement !== "inside") {
      const spaces = await tx.space.findMany({ where: { workspaceId }, select, orderBy: [...order] });
      if (!spaces.some((row) => row.id === source.id) || !spaces.some((row) => row.id === target.id)) throw new ApiError(404, "Space not found");
      for (const [index, id] of ranked(spaces, source.id, target.id, placement).entries()) {
        if (spaces[index]?.id !== id || spaces[index]?.position !== (index + 1) * 1000) await tx.space.update({ where: { id }, data: { position: (index + 1) * 1000 } });
      }
      return;
    }
    if (source.kind === "folder" && target.kind === "folder" && placement !== "inside") {
      const folder = await tx.folder.findFirst({ where: { id: source.id, space: { workspaceId } }, select: { spaceId: true } });
      if (!folder) throw new ApiError(404, "Folder not found");
      const folders = await tx.folder.findMany({ where: { spaceId: folder.spaceId }, select, orderBy: [...order] });
      if (!folders.some((row) => row.id === target.id)) throw new ApiError(400, "Reorder folders within their space");
      for (const [index, id] of ranked(folders, source.id, target.id, placement).entries()) {
        if (folders[index]?.id !== id || folders[index]?.position !== (index + 1) * 1000) await tx.folder.update({ where: { id }, data: { position: (index + 1) * 1000 } });
      }
      return;
    }
    if (source.kind !== "list") throw new ApiError(400, "Choose a compatible destination");
    const list = await tx.list.findFirst({ where: { id: source.id, archivedAt: null, space: { workspaceId } }, select: { spaceId: true, folderId: true } });
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
    const siblings = await tx.list.findMany({ where: { ...destination, archivedAt: null }, select, orderBy: [...order] });
    const ids = ranked(siblings, source.id, target.id, placement);
    if (destination.spaceId !== list.spaceId) {
      await tx.taskTag.deleteMany({ where: { task: { listId: source.id }, tag: { spaceId: { not: destination.spaceId } } } });
    }
    for (const [index, id] of ids.entries()) {
      const position = (index + 1) * 1000;
      if (id === source.id || siblings[index]?.id !== id || siblings[index]?.position !== position) {
        await tx.list.update({ where: { id }, data: { position, ...(id === source.id && destination) } });
      }
    }
  });
  publish({ type: "bootstrap" });
  if (source.kind === "list") publish({ type: "list", listId: source.id });
  return NextResponse.json({ ok: true });
});
