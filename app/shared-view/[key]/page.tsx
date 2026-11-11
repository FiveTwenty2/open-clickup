"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

type SharedView = {
  name: string;
  tasks: { id: string; name: string; priority: string | null; milestone: boolean; dueDate: string | null; status: { name: string } }[];
};

export default function SharedViewPage() {
  const { key } = useParams<{ key: string }>();
  const { data, isPending, isError } = useQuery({
    queryKey: ["shared-view", key],
    queryFn: () => apiGet<SharedView>(`/api/public/views/${encodeURIComponent(key)}`),
    retry: false,
  });
  return <main className="mx-auto min-h-dvh w-full max-w-4xl p-6 pt-12">
    {isPending && <p role="status">Loading shared view…</p>}
    {isError && <p role="alert">This shared view is unavailable.</p>}
    {data && <>
      <h1 className="text-xl font-semibold">{data.name}</h1>
      <p className="mt-1 text-sm text-cu-text-secondary">Read-only task summary</p>
      {data.tasks.length ? <div className="mt-4 overflow-x-auto rounded border border-cu-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-cu-panel"><tr>{["Task", "Status", "Priority", "Due"].map((label) => <th key={label} className="px-4 py-2">{label}</th>)}</tr></thead>
          <tbody>{data.tasks.map((task) => <tr key={task.id} className="border-t border-cu-border">
            <td className="px-4 py-2">{task.milestone ? "◆ " : ""}{task.name}</td>
            <td className="px-4 py-2">{task.status.name}</td>
            <td className="px-4 py-2 capitalize">{task.priority?.toLowerCase() ?? "—"}</td>
            <td className="px-4 py-2">{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="mt-4 text-sm">No tasks match this view.</p>}
    </>}
  </main>;
}
