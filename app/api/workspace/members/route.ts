import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { requireRole } from "@/lib/permissions";
import { publish } from "@/lib/events";

export const PATCH = route(async (req) => {
  const actor = await requireRole("ADMIN");
  const { userId, role } = await readJson(req, z.object({
    userId: z.string().min(1), role: z.enum(["ADMIN", "MEMBER", "GUEST"]).nullable(),
  }));
  if (actor.user.id === userId) throw new ApiError(403, "You cannot change your own membership");
  if (role === "ADMIN" && actor.role !== "OWNER") throw new ApiError(403, "Only the owner can appoint administrators");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${actor.workspaceId} FOR UPDATE`;
    const where = { workspaceId: actor.workspaceId, userId, role: { in: actor.role === "OWNER" ? ["ADMIN", "MEMBER", "GUEST"] as const : ["MEMBER", "GUEST"] as const } };
    const allowed = { ...where, role: { in: [...where.role.in] } };
    const changed = role
      ? await tx.workspaceMember.updateMany({ where: allowed, data: { role } })
      : await tx.workspaceMember.deleteMany({ where: allowed });
    if (!changed.count) throw new ApiError(403, "You cannot manage this membership");
    if (!role) {
      await tx.viewReader.deleteMany({ where: { userId, view: { list: { space: { workspaceId: actor.workspaceId } } } } });
      await tx.scopedViewReader.deleteMany({ where: { userId, view: { workspaceId: actor.workspaceId } } });
      await tx.accessTeamMember.deleteMany({ where: { userId, team: { workspaceId: actor.workspaceId } } });
      await tx.apiToken.deleteMany({ where: { userId, workspaceId: actor.workspaceId } });
      await tx.session.deleteMany({ where: { userId } });
    }
  });
  publish({ type: "bootstrap" });
  return NextResponse.json({ ok: true });
});
