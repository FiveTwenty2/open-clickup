"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";
import { cn } from "@/lib/utils";

export function SiblingDrag({ task, children, enabled = true }: {
  task: { id: string; name: string; listId: string; parentId: string | null }; children: ReactNode; enabled?: boolean;
}) {
  const { workspace, currentUser } = useWorkspace();
  const allowed = enabled && task.parentId && workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");
  const key = `application/x-clickup-subtask-${task.parentId?.toLowerCase()}`;
  const [hint, setHint] = useState<"before" | "after" | null>(null);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: ({ taskId, placement }: { taskId: string; placement: "before" | "after" }) =>
      apiSend(`/api/lists/${task.listId}/reorder`, "POST", { taskId, targetId: task.id, placement }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ["list", task.listId] }),
        client.invalidateQueries({ queryKey: ["task", task.parentId] })]);
    },
  });
  if (!allowed) return children;
  return <div className={cn("relative pl-5", hint === "before" && "border-t-2 border-cu-purple", hint === "after" && "border-b-2 border-cu-purple")}
    onDragOver={(event) => {
      if (!event.dataTransfer.types.includes(key)) return;
      event.preventDefault(); event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setHint(event.clientY < rect.top + rect.height / 2 ? "before" : "after");
    }} onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHint(null);
    }} onDrop={(event) => {
      const taskId = event.dataTransfer.getData(key);
      if (!taskId) return;
      event.preventDefault(); event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setHint(null);
      if (taskId !== task.id) save.mutate({ taskId, placement: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
    }}>
    <span aria-label={`Reorder ${task.name}`} title={`Drag ${task.name}`} draggable
      className="absolute left-1 top-2 cursor-grab text-cu-text-tertiary"
      onDragStart={(event) => { event.dataTransfer.setData(key, task.id); event.dataTransfer.effectAllowed = "move"; }}>
      <GripVertical className="h-4 w-4" />
    </span>
    {children}
    {save.isError && <p role="alert" className="text-xs text-cu-urgent">Could not save subtask order.</p>}
  </div>;
}
