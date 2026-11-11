import { prisma } from "@/lib/db";
import { requireIntegrationAccess } from "@/lib/integration-access";
import { ApiError, route } from "@/lib/api-helpers";
import { attachmentResponse, imageMime, readLegacyUpload } from "@/lib/attachment-files";

type Ctx = { params: Promise<{ name: string }> };
export const GET = route(async (req, { params }: Ctx) => {
  const { name } = await params;
  const { workspaceId } = await requireIntegrationAccess(req);
  const url = "/uploads/" + name;
  if (name.startsWith("avatar-")) {
    const owner = await prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { avatarUrl: url } }, select: { userId: true },
    });
    if (!owner) throw new ApiError(404, "File not found");
    const bytes = await readLegacyUpload(name);
    if (!imageMime(bytes)) throw new ApiError(404, "Image not found");
    return attachmentResponse(bytes, name, true);
  }
  const attachment = await prisma.attachment.findFirst({
    where: { url, task: { deletedAt: null, list: { space: { workspaceId } } } }, select: { name: true },
  });
  if (!attachment) throw new ApiError(404, "File not found");
  return attachmentResponse(await readLegacyUpload(name), attachment.name, true);
});
