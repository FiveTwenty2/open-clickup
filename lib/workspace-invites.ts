import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api-helpers";
import type { Prisma } from "@/lib/generated/prisma/client";

export const inviteMetadata = { id: true, email: true, role: true, expiresAt: true } as const;
export const inviteDigest = (token: string) => createHash("sha256").update(token).digest("hex");
export const makeInvite = () => randomBytes(32).toString("base64url");

export async function consumeInvite(tx: Prisma.TransactionClient, token: string, email: string, userId: string) {
  const invite = await tx.workspaceInvite.findUnique({ where: { digest: inviteDigest(token) } });
  if (!invite || invite.expiresAt <= new Date() || invite.email !== email) {
    throw new ApiError(403, "This invitation is invalid, expired, or for another email address");
  }
  const used = await tx.workspaceInvite.deleteMany({ where: { id: invite.id, digest: invite.digest } });
  if (!used.count) throw new ApiError(403, "This invitation has already been used");
  await tx.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
    create: { workspaceId: invite.workspaceId, userId, role: invite.role },
    update: {},
  });
}
