import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { ApiError, readJson, route } from "@/lib/api-helpers";
import { createListFromTemplate, snapshotList } from "@/lib/list-templates";
import { validateListLocation } from "@/lib/hierarchy";
import { publish } from "@/lib/events";

const metadata = { id: true, name: true, updatedAt: true } as const;
const save = z.object({
  sourceListId: z.string().min(1), name: z.string().trim().min(1).max(100), includeTasks: z.boolean().default(true),
});
const create = z.object({
  templateId: z.string().min(1), name: z.string().trim().min(1).max(150), spaceId: z.string().min(1),
  folderId: z.string().nullish(), includeTasks: z.boolean().default(true), includeDates: z.boolean().default(false), includeAutomations: z.boolean().default(false),
});
export const GET = route(async (req) => {
  const { workspaceId, role } = await requireIntegrationAccess(req);
  if (role === "GUEST") throw new ApiError(403, "List templates require member access");
  return NextResponse.json(await prisma.listTemplate.findMany({ where: { workspaceId }, select: metadata, orderBy: { name: "asc" } }));
});
export const POST = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req, true);
  const { sourceListId, name, includeTasks } = await readJson(req, save);
  const snapshot = await snapshotList(workspaceId, sourceListId, includeTasks);
  const template = await prisma.listTemplate.create({
    data: { name, workspaceId, snapshot: snapshot as Prisma.InputJsonValue }, select: metadata,
  }).catch(handleDuplicate);
  return NextResponse.json(template, { status: 201 });
});
export const PATCH = route(async (req) => {
  const { workspaceId } = await requireIntegrationAccess(req, true);
  const { id, sourceListId, name, includeTasks } = await readJson(req, save.extend({ id: z.string().min(1) }));
  const snapshot = await snapshotList(workspaceId, sourceListId, includeTasks);
  const template = await prisma.listTemplate.update({
    where: { id, workspaceId }, data: { name, snapshot: snapshot as Prisma.InputJsonValue }, select: metadata,
  }).catch(handleDuplicate);
  return NextResponse.json(template);
});
export const PUT = route(async (req) => {
  const { user, workspaceId, role } = await requireIntegrationAccess(req, true);
  const input = await readJson(req, create);
  if (input.includeAutomations && role !== "ADMIN" && role !== "OWNER") throw new ApiError(403, "Only workspace admins can copy automation rules");
  await validateListLocation(workspaceId, input.spaceId, input.folderId);
  const list = await createListFromTemplate({ ...input, workspaceId, actorId: user.id });
  publish({ type: "bootstrap" });
  return NextResponse.json(list, { status: 201 });
});

function handleDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ApiError(409, "A list template already has that name");
  throw error;
}
