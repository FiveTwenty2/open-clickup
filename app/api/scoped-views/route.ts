import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";
import { getScopedViewTasks, getViewDependencies, getViewScope, scopedListWhere } from "@/lib/scoped-views";
import { VIEW_KINDS } from "@/lib/view-kind";

const input = z.object({
  spaceId: z.string().min(1).nullish(),
  folderId: z.string().min(1).nullish(),
  name: z.string().trim().min(1).max(80),
  type: z.enum(VIEW_KINDS),
  private: z.boolean().default(false),
});

export const GET = route(async (req) => {
  const { user, workspaceId } = await requireRole("GUEST");
  const params = new URL(req.url).searchParams;
  const { scope, name } = await getViewScope(workspaceId, params.get("spaceId"), params.get("folderId"));
  const [views, tasks, lists] = await Promise.all([
    prisma.scopedView.findMany({
      where: { ...scope, OR: [{ privateOwnerId: null }, { privateOwnerId: user.id }, { readers: { some: { userId: user.id } } }] },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    }),
    getScopedViewTasks(scope),
    prisma.list.findMany({ where: await scopedListWhere(scope),
      select: { id: true, name: true, statuses: { orderBy: { position: "asc" } } }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
  ]);
  const dependencies = views.some((view) => view.type === "GANTT") ? await getViewDependencies(tasks.map(({ id }) => id)) : [];
  return NextResponse.json({ name, views, tasks, lists, dependencies }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route(async (req) => {
  const { user, workspaceId } = await requireRole("MEMBER");
  const { spaceId, folderId, name, type, private: isPrivate } = await readJson(req, input);
  const { scope } = await getViewScope(workspaceId, spaceId ?? null, folderId ?? null);
  const view = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    const last = await tx.scopedView.aggregate({ where: scope, _max: { position: true } });
    return tx.scopedView.create({
      data: { ...scope, name, type, privateOwnerId: isPrivate ? user.id : null, position: (last._max.position ?? 0) + 1 },
    });
  });
  publish({ type: "bootstrap" });
  return NextResponse.json(view, { status: 201 });
});
