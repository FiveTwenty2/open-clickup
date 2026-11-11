import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api-helpers";

const legacyName = /^(?:avatar-)?[0-9a-f-]{36}(?:\.[a-z0-9]{1,11})?$/i;
const uploads = path.join(process.cwd(), "public", "uploads");

export async function readLegacyUpload(name: string) {
  if (!legacyName.test(name)) throw new ApiError(404, "File not found");
  try { return await readFile(path.join(uploads, name)); }
  catch { throw new ApiError(404, "File not found"); }
}

export async function removeLegacyAttachment(url: string) {
  if (!url.startsWith("/uploads/")) return;
  const name = url.slice("/uploads/".length);
  if (!name.startsWith("avatar-") && legacyName.test(name)) await unlink(path.join(uploads, name)).catch(() => {});
}

export function imageMime(bytes: Uint8Array) {
  const header = Buffer.from(bytes.subarray(0, 16));
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(header.toString("ascii"))) return "image/gif";
  if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function attachmentResponse(bytes: Uint8Array, name: string, inline: boolean) {
  const image = inline ? imageMime(bytes) : null;
  const safeName = encodeURIComponent(Buffer.from(name).toString("utf8")).replace(/[!'()*]/g, (char) => "%" + char.charCodeAt(0).toString(16));
  return new NextResponse(new Uint8Array(bytes), { headers: {
    "Content-Type": image ?? "application/octet-stream",
    "Content-Disposition": (image ? "inline" : "attachment") + "; filename*=UTF-8''" + safeName,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
