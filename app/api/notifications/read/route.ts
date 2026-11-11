import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { publish } from "@/lib/events";
import { readJson, route } from "@/lib/api-helpers";

// Mark notifications read. Body { ids } marks those; omit/empty marks all.
const schema = z.object({ ids: z.array(z.string()).min(1).max(100).optional() });

export const POST = route(async (req) => {
  const user = await requireUser();
  const { ids } = req.body ? await readJson(req, schema) : { ids: undefined };
  await prisma.notification.updateMany({
    where: { userId: user.id, read: false, archivedAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { read: true },
  });
  publish({ type: "notifications", userIds: [user.id] });
  return NextResponse.json({ ok: true });
});
