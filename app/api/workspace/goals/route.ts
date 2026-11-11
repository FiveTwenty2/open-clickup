import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readJson, route } from "@/lib/api-helpers";
import { requireRole } from "@/lib/permissions";
import { goalInput, listGoals } from "@/lib/workspace-goals";
import { publish } from "@/lib/events";

export const GET = route(async (req) => {
  const { workspaceId } = await requireRole("GUEST");
  return NextResponse.json(await listGoals(workspaceId, new URL(req.url).searchParams.get("archived") === "true"));
});

export const POST = route(async (req) => {
  const { workspaceId } = await requireRole("MEMBER");
  const body = await readJson(req, goalInput);
  const goal = await prisma.workspaceGoal.create({ data: { ...body, workspaceId } });
  publish({ type: "goals" });
  return NextResponse.json(goal, { status: 201 });
});
