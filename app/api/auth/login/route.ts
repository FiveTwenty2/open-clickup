import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { readJson, route, ApiError } from "@/lib/api-helpers";
import { rateLimit, clientIp, clearRateLimit } from "@/lib/rate-limit";
import { consumeInvite } from "@/lib/workspace-invites";
import { publish } from "@/lib/events";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(256),
  invite: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
});

export const POST = route(async (req) => {
  const ip = clientIp(req);
  const { email, password, invite } = await readJson(req, schema);
  const key = `login:${ip}:${email}`;
  const ipLimit = rateLimit(`login-ip:${ip}`, 120, 60_000);
  const rl = ipLimit.ok ? rateLimit(key, 10, 60_000) : ipLimit;
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many login attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new ApiError(401, "Invalid email or password");
  }
  clearRateLimit(key);
  if (invite) {
    await prisma.$transaction((tx) => consumeInvite(tx, invite, email, user.id));
    publish({ type: "bootstrap" });
  } else if (!(await prisma.workspaceMember.findFirst({ where: { userId: user.id }, select: { id: true } }))) {
    throw new ApiError(403, "Ask a workspace administrator for an invitation");
  }
  await createSession(user.id);
  return NextResponse.json({ id: user.id, name: user.name, email: user.email });
});
