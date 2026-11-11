"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

type TaskSummary = {
  name: string; priority: string | null; milestone: boolean; startDate: string | null; dueDate: string | null;
  status: { name: string };
};
export default function PublicTaskPage() {
  const { key } = useParams<{ key: string }>();
  const query = useQuery({
    queryKey: ["public-task", key], queryFn: () => apiGet<TaskSummary>(`/api/public/tasks/${encodeURIComponent(key)}`), retry: false,
  });
  const task = query.data;
  return <main className="mx-auto min-h-dvh w-full max-w-2xl p-6 pt-12">
    {query.isPending && <p role="status">Loading shared task…</p>}
    {query.isError && <p role="alert">This shared task is unavailable.</p>}
    {task && <article className="rounded border border-cu-border bg-cu-panel p-5">
      <h1 className="text-xl font-semibold">{task.name}</h1>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
        <dt>Status</dt><dd>{task.status.name}</dd>
        {task.milestone && <><dt>Type</dt><dd>Milestone</dd></>}
        {task.priority && <><dt>Priority</dt><dd className="capitalize">{task.priority.toLowerCase()}</dd></>}
        {task.startDate && <><dt>Start</dt><dd>{new Date(task.startDate).toLocaleDateString()}</dd></>}
        {task.dueDate && <><dt>Due</dt><dd>{new Date(task.dueDate).toLocaleDateString()}</dd></>}
      </dl>
    </article>}
  </main>;
}
