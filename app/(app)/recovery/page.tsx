"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import type { getRecoveryTasks } from "@/lib/task-recovery";
import { useWorkspace } from "@/components/workspace-context";

const button = "rounded border border-cu-border px-3 py-1.5 text-sm hover:bg-cu-hover disabled:opacity-50";

export default function RecoveryPage() {
  return <Suspense fallback={<p className="p-5">Loading recovery…</p>}><RecoveryFromUrl /></Suspense>;
}

function RecoveryFromUrl() {
  const mode = useSearchParams().get("mode") === "trash" ? "trash" : "archive";
  return <Recovery key={mode} initialMode={mode} />;
}

function Recovery({ initialMode }: { initialMode: "archive" | "trash" }) {
  const [mode, setMode] = useState(initialMode);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const { workspace, currentUser } = useWorkspace();
  const canRestore = workspace.members.find((member) => member.userId === currentUser.id)?.role !== "GUEST";
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["recovery", mode, page, search],
    queryFn: () => apiGet<Awaited<ReturnType<typeof getRecoveryTasks>>>(`/api/tasks/recovery?mode=${mode}&page=${page}&q=${encodeURIComponent(search)}`),
  });
  const restore = useMutation({
    mutationFn: (id: string) => apiSend("/api/tasks/recovery", "POST", { id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["recovery"] }),
  });

  return (
    <main className="flex-1 overflow-auto p-5 sm:p-8">
      <h1 className="text-xl font-semibold">Archive and Trash</h1>
      <div className="my-4 flex gap-2" aria-label="Recovery categories">
        {(["archive", "trash"] as const).map((category) => (
          <button key={category} className={button + " aria-pressed:border-cu-purple aria-pressed:text-cu-purple"} aria-pressed={mode === category} onClick={() => { setMode(category); setPage(0); restore.reset(); }}>
            {category === "archive" ? "Archive" : "Trash"}
          </button>
        ))}
      </div>
      <input aria-label="Search archived or trashed tasks" placeholder="Search by task name" className={button + " mb-4 bg-cu-panel"}
        value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
      {query.isPending && <p>Loading tasks…</p>}
      {query.isError && <p role="alert">Could not load tasks.</p>}
      {restore.isError && <p role="alert">Could not restore this task. Restore its parent first if needed.</p>}
      {query.data?.tasks.length === 0 && <p className="text-sm text-cu-text-secondary">{mode === "archive" ? "No archived tasks." : "Trash is empty."}</p>}
      <ul className="divide-y divide-cu-border">
        {query.data?.tasks.map((task) => (
          <li key={task.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              {mode === "archive" ? <Link href={`/l/${task.listId}?task=${task.id}`} className="font-medium hover:underline">{task.name}</Link> : <span className="font-medium">{task.name}</span>}
              <p className="text-sm text-cu-text-secondary">{task.list.space.name} / {task.list.name} · {task.status.name}</p>
              {task.activities[0] && (
                <p className="text-xs text-cu-text-secondary">
                  {mode === "archive" ? "Archived" : "Moved to Trash"}
                  {task.activities[0].user && ` by ${task.activities[0].user.name}`}
                  {" · "}{new Date(task.activities[0].createdAt).toLocaleString()}
                </p>
              )}
            </div>
            {canRestore && <button className={button} disabled={restore.isPending} onClick={() => restore.mutate(task.id)} aria-label={`Restore ${task.name}`}>{mode === "archive" ? "Unarchive" : "Restore"}</button>}
          </li>
        ))}
      </ul>
      {(page > 0 || query.data?.hasNext) && <div className="mt-4 flex gap-2">
        <button className={button} disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
        <button className={button} disabled={!query.data?.hasNext} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
    </main>
  );
}
