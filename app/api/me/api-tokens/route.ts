import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { requireRole } from "@/lib/permissions";
import { newIntegrationToken, tokenDigest, tokenMetadata } from "@/lib/integration-access";

const createSchema = z.object({ name: z.string().trim().min(1).max(80), writable: z.boolean().default(false) });
const revokeSchema = z.object({ id: z.string().min(1) });
const noStore = { "Cache-Control": "no-store" };

export const GET = route(async () => {
  const { user, workspaceId } = await requireRole("GUEST");
  const tokens = await prisma.apiToken.findMany({
    where: { userId: user.id, workspaceId }, select: tokenMetadata, orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(tokens, { headers: noStore });
});

export const POST = route(async (req) => {
  const { user, workspaceId, role } = await requireRole("GUEST");
  const { name, writable } = await readJson(req, createSchema);
  if (writable && role === "GUEST") throw new ApiError(403, "Guests can only create read-only tokens");
  const token = newIntegrationToken();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const metadata = await prisma.apiToken.create({
    data: { userId: user.id, workspaceId, name, writable, expiresAt, digest: tokenDigest(token), prefix: token.slice(0, 12) },
    select: tokenMetadata,
  });
  return NextResponse.json({ ...metadata, token }, { status: 201, headers: noStore });
});

export const DELETE = route(async (req) => {
  const { user, workspaceId } = await requireRole("GUEST");
  const { id } = await readJson(req, revokeSchema);
  const removed = await prisma.apiToken.deleteMany({ where: { id, userId: user.id, workspaceId } });
  if (!removed.count) throw new ApiError(404, "API token not found");
  return NextResponse.json({ ok: true }, { headers: noStore });
});
