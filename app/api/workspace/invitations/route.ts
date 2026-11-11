import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { requireRole } from "@/lib/permissions";
import { inviteDigest, inviteMetadata, makeInvite } from "@/lib/workspace-invites";

const input = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["GUEST", "MEMBER", "ADMIN"]) });
const noStore = { "Cache-Control": "no-store" };

export const GET = route(async () => {
  const { workspaceId } = await requireRole("ADMIN");
  return NextResponse.json(await prisma.workspaceInvite.findMany({
    where: { workspaceId }, orderBy: { createdAt: "desc" }, select: inviteMetadata,
  }), { headers: noStore });
});

export const POST = route(async (req) => {
  const { workspaceId, role: actorRole } = await requireRole("ADMIN");
  const { email, role } = await readJson(req, input);
  if (role === "ADMIN" && actorRole !== "OWNER") throw new ApiError(403, "Only the owner can invite administrators");
  if (await prisma.workspaceMember.findFirst({ where: { workspaceId, user: { email } }, select: { id: true } })) {
    throw new ApiError(409, "This email already belongs to a workspace member");
  }
  const token = makeInvite();
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const digest = inviteDigest(token);
  const invite = await prisma.workspaceInvite.upsert({
    where: { workspaceId_email: { workspaceId, email } },
    create: { workspaceId, email, role, expiresAt, digest },
    update: { role, expiresAt, digest },
    select: inviteMetadata,
  });
  return NextResponse.json({ ...invite, path: `/login?invite=${token}` }, { status: 201, headers: noStore });
});

export const DELETE = route(async (req) => {
  const { workspaceId, role } = await requireRole("ADMIN");
  const { id } = await readJson(req, z.object({ id: z.string().min(1) }));
  const removed = await prisma.workspaceInvite.deleteMany({
    where: { id, workspaceId, ...(role !== "OWNER" && { role: { not: "ADMIN" } }) },
  });
  if (!removed.count) throw new ApiError(404, "Invitation not found");
  return NextResponse.json({ ok: true });
});
