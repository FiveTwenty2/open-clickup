"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";
import { cn } from "@/lib/utils";

type Kind = "space" | "folder" | "list";
type Item = { kind: Kind; id: string };
const prefix = "application/x-open-clickup-";

export function HierarchyDragRow({ kind, id, name, children }: {
  kind: Kind; id: string; name: string; children: ReactNode;
}) {
  const { workspace, currentUser } = useWorkspace();
  const canWrite = workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");
  const [hint, setHint] = useState<"before" | "after" | "inside" | null>(null);
  const client = useQueryClient();
  const reorder = useMutation({
    mutationFn: (input: { source: Item; placement: "before" | "after" | "inside" }) =>
      apiSend("/api/hierarchy/reorder", "POST", { ...input, target: { kind, id } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["bootstrap"] }),
  });

  function position(event: DragEvent<HTMLDivElement>) {
    const from = event.dataTransfer.types.find((type) => type.startsWith(prefix))?.slice(prefix.length);
    if (!canWrite || !from || (from !== kind && from !== "list")) return null;
    if (from === "list" && kind !== "list") return "inside";
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
  }

  return <div data-hierarchy-row={id} className="group/hierarchy relative" onDragOver={(event) => {
    const next = position(event);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setHint(next);
  }} onDragLeave={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHint(null);
  }} onDrop={(event) => {
    const placement = position(event);
    setHint(null);
    if (!placement) return;
    event.preventDefault();
    event.stopPropagation();
    const from = event.dataTransfer.types.find((type) => type.startsWith(prefix))?.slice(prefix.length) as Kind;
    const sourceId = event.dataTransfer.getData(prefix + from);
    if (sourceId && sourceId !== id) reorder.mutate({ source: { id: sourceId, kind: from }, placement });
  }}>
    <div className={cn(hint === "inside" && "rounded ring-1 ring-inset ring-cu-purple",
      hint === "before" && "shadow-[inset_0_2px_var(--cu-purple)]",
      hint === "after" && "shadow-[inset_0_-2px_var(--cu-purple)]")}>{children}</div>
    {canWrite && <span draggable aria-label={`Drag ${kind} ${name}`} title={`Drag ${name}`}
      className="absolute -left-1 top-1.5 cursor-grab text-cu-text-tertiary opacity-0 group-hover/hierarchy:opacity-100"
      onDragStart={(event) => { event.dataTransfer.setData(prefix + kind, id); event.dataTransfer.effectAllowed = "move"; }}>
      <GripVertical className="h-3.5 w-3.5" />
    </span>}
    {reorder.isError && <p role="alert" className="pl-4 text-xs text-cu-urgent">Could not move {name}.</p>}
  </div>;
}
