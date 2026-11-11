import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { userSelect } from "@/lib/queries";
import { readJson, route } from "@/lib/api-helpers";
import { publish } from "@/lib/events";

export const GET = route(async (req) => {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter");
  const page = Math.max(0, Math.min(10000, Number.parseInt(searchParams.get("page") ?? "", 10) || 0));
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId: user.id,
        archivedAt: filter === "archive" ? { not: null } : null,
        ...(filter === "unread" && { read: false }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: page * 30,
      take: 31,
      include: {
        actor: { select: userSelect },
        task: { select: { id: true, name: true, listId: true, deletedAt: true } },
      },
    }),
    prisma.notification.count({ where: { userId: user.id, read: false, archivedAt: null } }),
  ]);
  return NextResponse.json({ notifications: rows.slice(0, 30), unread, hasNext: rows.length > 30 });
});

export const PATCH = route(async (req) => {
  const user = await requireUser();
  const { ids, action } = await readJson(req, z.object({
    ids: z.array(z.string()).min(1).max(100),
    action: z.enum(["read", "unread", "archive", "restore"]),
  }));
  const data = action === "archive" ? { archivedAt: new Date() }
    : action === "restore" ? { archivedAt: null } : { read: action === "read" };
  await prisma.notification.updateMany({ where: { userId: user.id, id: { in: ids } }, data });
  publish({ type: "notifications", userIds: [user.id] });
  return NextResponse.json({ ok: true });
});
