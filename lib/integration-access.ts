import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/permissions";

export function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newIntegrationToken() {
  return `ocu_${randomBytes(32).toString("base64url")}`;
}

export const tokenMetadata = {
  id: true, name: true, prefix: true, writable: true, createdAt: true, expiresAt: true,
} as const;

/** Explicitly called by integration-enabled routes. Token administration still requires a browser session. */
export async function requireIntegrationAccess(req: Request, write = false) {
  const authorization = req.headers.get("authorization");
  if (authorization === null) return requireRole(write ? "MEMBER" : "GUEST");

  const match = /^Bearer (ocu_[A-Za-z0-9_-]{43})$/i.exec(authorization);
  if (!match) throw new ApiError(401, "Invalid API token");
  const token = await prisma.apiToken.findUnique({
    where: { digest: tokenDigest(match[1]) },
    select: { user: true, workspaceId: true, writable: true, expiresAt: true },
  });
  if (!token || token.expiresAt <= new Date()) throw new ApiError(401, "Invalid or expired API token");
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: token.workspaceId, userId: token.user.id } },
  });
  if (!membership || (write && (!token.writable || membership.role === "GUEST"))) {
    throw new ApiError(403, "This API token does not have the required workspace access");
  }
  return { user: token.user, workspaceId: token.workspaceId, role: membership.role };
}

export async function requireListInWorkspace(listId: string, workspaceId: string) {
  const list = await prisma.list.findFirst({
    where: { id: listId, space: { workspaceId } }, select: { id: true },
  });
  if (!list) throw new ApiError(404, "List not found");
}

export async function requireTaskInWorkspace(taskId: string, workspaceId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null, list: { space: { workspaceId } } },
    select: { listId: true, list: { select: { spaceId: true } } },
  });
  if (!task) throw new ApiError(404, "Task not found");
  return task;
}

export async function requireWorkspaceUsers(workspaceId: string, userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  const count = await prisma.workspaceMember.count({ where: { workspaceId, userId: { in: ids } } });
  if (count !== ids.length) throw new ApiError(400, "Select users from this workspace");
}
