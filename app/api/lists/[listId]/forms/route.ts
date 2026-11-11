import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireIntegrationAccess, requireListInWorkspace } from "@/lib/integration-access";
import { readJson, route } from "@/lib/api-helpers";
import { intakeFormSchema } from "@/lib/intake-schema";

type Ctx = { params: Promise<{ listId: string }> };

export const GET = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true);
  await requireListInWorkspace(listId, workspaceId);
  return NextResponse.json(await prisma.intakeForm.findMany({ where: { listId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }));
});

export const POST = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true);
  await requireListInWorkspace(listId, workspaceId);
  const data = await readJson(req, intakeFormSchema);
  const form = await prisma.intakeForm.create({ data: { ...data, listId, shareKey: randomBytes(24).toString("base64url") } });
  return NextResponse.json(form, { status: 201 });
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true);
  await requireListInWorkspace(listId, workspaceId);
  const { id, ...data } = await readJson(req, intakeFormSchema.extend({ id: z.string().min(1) }));
  const form = await prisma.intakeForm.update({ where: { id, listId }, data });
  return NextResponse.json(form);
});

export const DELETE = route(async (req, { params }: Ctx) => {
  const { listId } = await params;
  const { workspaceId } = await requireIntegrationAccess(req, true);
  await requireListInWorkspace(listId, workspaceId);
  const { id } = await readJson(req, z.object({ id: z.string().min(1) }));
  await prisma.intakeForm.delete({ where: { id, listId } });
  return NextResponse.json({ ok: true });
});
