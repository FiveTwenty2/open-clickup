import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { requireRole } from "@/lib/permissions";
import { permissionLevels, requireResourcePermission, resourceKind } from "@/lib/resource-permissions";

type Context = { params: Promise<{ kind: string; id: string }> };
const permission = z.enum(["VIEW", "COMMENT", "EDIT", "FULL"]);
const share = z.object({
  private: z.boolean(),
  grants: z.array(z.object({
    subjectType: z.enum(["person", "team"]),
    subjectId: z.string().min(1).max(200),
    permission,
  })).max(500),
});

async function target(ctx: Context, minimum: number) {
  const { kind: value, id } = await ctx.params;
  const kind = resourceKind.safeParse(value);
  if (!kind.success) throw new ApiError(404, "Location not found");
  const actor = await requireRole("GUEST");
  const level = await requireResourcePermission(kind.data, id, minimum);
  return { actor, kind: kind.data, id, level };
}

export const GET = route(async (_, ctx: Context) => {
  const { actor, kind, id, level } = await target(ctx, 1);
  const select = { private: true } as const;
  const where = { id };
  const item = await (
    kind === "space" ? prisma.space.findUnique({ where, select }) :
    kind === "folder" ? prisma.folder.findUnique({ where, select }) :
    kind === "list" ? prisma.list.findUnique({ where, select }) :
    prisma.task.findUnique({ where, select })
  );
  if (!item) throw new ApiError(404, "Location not found");
  const editable = level === permissionLevels.FULL;
  const [grants, people, teams] = editable ? await Promise.all([
    prisma.accessGrant.findMany({ where: { workspaceId: actor.workspaceId, resourceType: kind, resourceId: id } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: actor.workspaceId },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.accessTeam.findMany({ where: { workspaceId: actor.workspaceId }, orderBy: { name: "asc" } }),
  ]) : [[], [], []];
  return NextResponse.json({
    ...item,
    editable,
    canManageTeams: actor.role === "OWNER" || actor.role === "ADMIN",
    grants: grants.map(({ subjectType, subjectId, permission: value }) => ({
      subjectType, subjectId, permission: permission.options[value - 1],
    })),
    people: people.map(({ user }) => user),
    teams,
  });
});

export const PATCH = route(async (req, ctx: Context) => {
  const { actor, kind, id } = await target(ctx, permissionLevels.FULL);
  const input = await readJson(req, share);
  const distinct = new Set(input.grants.map(({ subjectType, subjectId }) => `${subjectType}:${subjectId}`));
  if (distinct.size !== input.grants.length) throw new ApiError(400, "Add each person or team only once");
  const workspaceId = actor.workspaceId;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    await requireResourcePermission(kind, id, permissionLevels.FULL, tx);
    const people = input.grants.filter(({ subjectType }) => subjectType === "person").map(({ subjectId }) => subjectId);
    const teams = input.grants.filter(({ subjectType }) => subjectType === "team").map(({ subjectId }) => subjectId);
    if (await tx.workspaceMember.count({ where: { workspaceId, userId: { in: people } } }) !== people.length
      || await tx.accessTeam.count({ where: { workspaceId, id: { in: teams } } }) !== teams.length) {
      throw new ApiError(400, "Each grant must identify a person or team in this workspace");
    }
    const where = { id };
    const data = { private: input.private, privacyOwnerId: input.private ? actor.user.id : null };
    const select = { id: true, private: true } as const;
    const item = await (
      kind === "space" ? tx.space.findUnique({ where, select }) :
      kind === "folder" ? tx.folder.findUnique({ where, select }) :
      kind === "list" ? tx.list.findUnique({ where, select }) :
      tx.task.findUnique({ where, select })
    );
    if (!item) throw new ApiError(404, "Location not found");
    if (item.private !== input.private) {
      if (kind === "space") await tx.space.update({ where, data });
      else if (kind === "folder") await tx.folder.update({ where, data });
      else if (kind === "list") await tx.list.update({ where, data });
      else await tx.task.update({ where, data });
    }
    const grants = JSON.stringify(input.grants.map((grant) => ({ ...grant, permission: permissionLevels[grant.permission] })));
    await tx.$executeRaw`SELECT oc_replace_grants(${kind}, ${id}, ${grants}::jsonb)`;
  });
  publish({ type: "bootstrap" });
  return NextResponse.json(input);
});
