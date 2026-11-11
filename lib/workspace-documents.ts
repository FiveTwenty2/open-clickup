import { prisma } from "@/lib/db";

export async function listDocuments(workspaceId: string, archived: boolean) {
  return prisma.workspaceDocument.findMany({
    where: { workspaceId, archived }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, title: true, revision: true, archived: true, updatedAt: true },
  });
}

export async function readDocument(workspaceId: string, id: string) {
  return prisma.workspaceDocument.findFirst({
    where: { id, workspaceId },
    select: { id: true, title: true, body: true, revision: true, archived: true, updatedAt: true },
  });
}
