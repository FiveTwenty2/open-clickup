import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ScopedViews } from "@/components/views/scoped-views";

export default async function ScopedViewPage({ params }: { params: Promise<{ location?: string[] }> }) {
  const parts = (await params).location ?? ["workspace"];
  const [kind, id] = parts;
  if (kind === "workspace" && parts.length === 1) {
    return <Suspense fallback={<p className="p-5">Loading views…</p>}><ScopedViews /></Suspense>;
  }
  if ((kind === "space" || kind === "folder") && parts.length === 2 && id) {
    return <Suspense fallback={<p className="p-5">Loading views…</p>}>
      <ScopedViews spaceId={kind === "space" ? id : undefined} folderId={kind === "folder" ? id : undefined} />
    </Suspense>;
  }
  notFound();
}
