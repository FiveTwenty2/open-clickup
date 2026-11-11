import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/events";
import { requireRole } from "@/lib/permissions";

const teamInput = z.object({ name: z.string().trim().min(1).max(80), userIds: z.array(z.string().min(1)).max(500) });
const teamId = z.object({ id: z.string().min(1) });
const selection = { members: { select: { userId: true } } } as const;

export const GET = route(async () => {
  const { workspaceId } = await requireRole("GUEST");
  const teams = await prisma.accessTeam.findMany({ where: { workspaceId }, include: selection, orderBy: { name: "asc" } });
  return NextResponse.json(teams);
});

async function save(workspaceId: string, input: z.infer<typeof teamInput>, id?: string) {
  const userIds = [...new Set(input.userIds)];
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    const matching = await tx.workspaceMember.count({ where: { workspaceId, userId: { in: userIds } } });
    if (matching !== userIds.length) throw new ApiError(400, "Each team member must belong to this workspace");
    const duplicate = await tx.accessTeam.findFirst({ where: { workspaceId, name: { equals: input.name, mode: "insensitive" }, NOT: id ? { id } : undefined } });
    if (duplicate) throw new ApiError(409, "A team with this name already exists");
    if (id) {
      await tx.accessTeam.update({ where: { id, workspaceId }, data: { name: input.name } });
      await tx.accessTeamMember.deleteMany({ where: { teamId: id } });
      await tx.accessTeamMember.createMany({ data: userIds.map((userId) => ({ userId, teamId: id })) });
      return tx.accessTeam.findUniqueOrThrow({ where: { id }, include: selection });
    }
    return tx.accessTeam.create({
      data: { name: input.name, workspaceId, members: { create: userIds.map((userId) => ({ userId })) } },
      include: selection,
    });
  });
}

export const POST = route(async (req) => {
  const { workspaceId } = await requireRole("ADMIN");
  const team = await save(workspaceId, await readJson(req, teamInput));
  publish({ type: "bootstrap" });
  return NextResponse.json(team, { status: 201 });
});

export const PATCH = route(async (req) => {
  const { workspaceId } = await requireRole("ADMIN");
  const { id, ...input } = await readJson(req, teamId.extend(teamInput.shape));
  const team = await save(workspaceId, input, id);
  publish({ type: "bootstrap" });
  return NextResponse.json(team);
});

export const DELETE = route(async (req) => {
  const { workspaceId } = await requireRole("ADMIN");
  const { id } = await readJson(req, teamId);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    await tx.accessTeam.delete({ where: { id, workspaceId } });
  });
  publish({ type: "bootstrap" });
  return NextResponse.json({ ok: true });
});
