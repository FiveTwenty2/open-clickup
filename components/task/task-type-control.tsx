"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export type TaskType = { id: string; name: string; color: string };
export function useTaskTypes() {
  return useQuery({ queryKey: ["task-types"], queryFn: () => apiGet<TaskType[]>("/api/workspace/task-types") });
}

export function TaskTypeControl({ value, editable, onChange }: {
  value: TaskType | null; editable: boolean; onChange: (id: string | null) => void;
}) {
  const types = useTaskTypes();
  if (!editable) return value ? <span className="text-xs" style={{ color: value.color }}>{value.name}</span> : null;
  return <label className="flex items-center gap-1 text-xs">
    <span className="text-cu-text-secondary">Task type</span>
    <select aria-label="Task type" value={value?.id ?? ""} disabled={types.isPending || types.isError}
      className="rounded border border-cu-border bg-cu-panel px-2 py-1" onChange={(event) => onChange(event.target.value || null)}>
      <option value="">Task</option>
      {types.data?.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
    </select>
  </label>;
}
