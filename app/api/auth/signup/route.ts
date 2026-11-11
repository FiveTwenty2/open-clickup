import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { colorFromString } from "@/lib/utils";
import { readJson, route, ApiError } from "@/lib/api-helpers";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { consumeInvite } from "@/lib/workspace-invites";
import { publish } from "@/lib/events";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(256),
  invite: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
});

export const POST = route(async (req) => {
  const rl = rateLimit(`signup:${clientIp(req)}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many sign-up attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  const { name, email, password, invite } = await readJson(req, schema);
  const passwordHash = hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    if (!invite) {
      await tx.$queryRaw`SELECT 1 AS acquired FROM pg_advisory_xact_lock(490014491)`;
      if (await tx.workspace.count()) throw new ApiError(403, "Ask a workspace administrator for an invitation");
    }
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ApiError(409, "This email already has an account. Sign in to accept an invitation.");
    const account = await tx.user.create({
      data: { name, email, passwordHash, color: colorFromString(email) },
      select: { id: true, name: true, email: true },
    });
    if (invite) await consumeInvite(tx, invite, email, account.id);
    else await tx.workspace.create({
      data: { name: "My Workspace", members: { create: { userId: account.id, role: "OWNER" } } },
    });
    return account;
  });

  await createSession(user.id);
  publish({ type: "bootstrap" });
  return NextResponse.json({ id: user.id, name: user.name, email: user.email }, { status: 201 });
});
