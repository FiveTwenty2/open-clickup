import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess, requireTaskInWorkspace } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";

type Ctx = { params: Promise<{ taskId: string }> };
const url = z.url({ protocol: /^https?$/ }).max(2000);
const scope = (workspaceId: string) => ({ deletedAt: null, list: { space: { workspaceId } } });
const summary = { id: true, listId: true, name: true } as const;

export const GET = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req);
  await requireTaskInWorkspace(taskId, workspaceId);
  const [related, links] = await Promise.all([
    prisma.taskRelationship.findMany({
      where: { OR: [{ leftId: taskId, right: scope(workspaceId) }, { rightId: taskId, left: scope(workspaceId) }] },
      include: { left: { select: summary }, right: { select: summary } }, orderBy: { id: "asc" },
    }),
    prisma.taskResourceLink.findMany({ where: { taskId }, orderBy: { id: "asc" } }),
  ]);
  return NextResponse.json({ links, related: related.map(({ id, left, right }) => ({ id, task: left.id === taskId ? right : left })) });
});

export const POST = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { user, workspaceId } = await requireIntegrationAccess(req, true);
  const source = await requireTaskInWorkspace(taskId, workspaceId);
  const data = await readJson(req, z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("task"), otherId: z.string().min(1) }),
    z.object({ kind: z.literal("link"), title: z.string().trim().min(1).max(150), url }),
  ]));
  const lists = [source.listId];
  if (data.kind === "task") {
    if (data.otherId === taskId) throw new ApiError(400, "Choose a different task");
    lists.push((await requireTaskInWorkspace(data.otherId, workspaceId)).listId);
  }
  await prisma.$transaction(async (tx) => {
    if (data.kind === "task") {
      const [leftId, rightId] = [taskId, data.otherId].sort();
      const result = await tx.taskRelationship.createMany({ data: { leftId, rightId }, skipDuplicates: true });
      if (!result.count) throw new ApiError(409, "These tasks are already related");
    } else {
      const result = await tx.taskResourceLink.createMany({ data: { taskId, title: data.title, url: data.url }, skipDuplicates: true });
      if (!result.count) throw new ApiError(409, "This link is already attached");
    }
    await tx.activity.create({ data: { taskId, userId: user.id, type: "relationship_added" } });
  });
  for (const listId of new Set(lists)) publish({ type: "list", listId });
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const DELETE = route(async (req, { params }: Ctx) => {
  const { taskId } = await params;
  const { user, workspaceId } = await requireIntegrationAccess(req, true);
  const source = await requireTaskInWorkspace(taskId, workspaceId);
  const { kind, id } = await readJson(req, z.object({ kind: z.enum(["task", "link"]), id: z.string().min(1) }));
  const lists = [source.listId];
  await prisma.$transaction(async (tx) => {
    if (kind === "task") {
      const where = { id, OR: [{ leftId: taskId, right: scope(workspaceId) }, { rightId: taskId, left: scope(workspaceId) }] };
      const relationship = await tx.taskRelationship.findFirst({
        where, select: { left: { select: { listId: true } }, right: { select: { listId: true } } },
      });
      if (!relationship || !(await tx.taskRelationship.deleteMany({ where })).count) throw new ApiError(404, "Relationship not found");
      lists.push(relationship.left.listId, relationship.right.listId);
    } else if (!(await tx.taskResourceLink.deleteMany({ where: { id, taskId } })).count) throw new ApiError(404, "Link not found");
    await tx.activity.create({ data: { taskId, userId: user.id, type: "relationship_removed" } });
  });
  for (const listId of new Set(lists)) publish({ type: "list", listId });
  return NextResponse.json({ ok: true });
});
