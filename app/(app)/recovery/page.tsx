"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import type { getRecoveryTasks } from "@/lib/task-recovery";
import { useWorkspace } from "@/components/workspace-context";

type ArchivedList = { id: string; name: string; archivedAt: string; archivedBy: string | null; space: { name: string }; folder: { name: string } | null };

const button = "rounded border border-cu-border px-3 py-1.5 text-sm hover:bg-cu-hover disabled:opacity-50";

export default function RecoveryPage() {
  return <Suspense fallback={<p className="p-5">Loading recovery…</p>}><RecoveryFromUrl /></Suspense>;
}

function RecoveryFromUrl() {
  const mode = useSearchParams().get("mode");
  return <Recovery key={mode} initialMode={mode === "trash" || mode === "lists" ? mode : "archive"} />;
}

function Recovery({ initialMode }: { initialMode: "archive" | "trash" | "lists" }) {
  const [mode, setMode] = useState(initialMode);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const { workspace, currentUser } = useWorkspace();
  const canRestore = workspace.members.find((member) => member.userId === currentUser.id)?.role !== "GUEST";
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["recovery", mode, page, search],
    enabled: mode !== "lists",
    queryFn: () => apiGet<Awaited<ReturnType<typeof getRecoveryTasks>>>(`/api/tasks/recovery?mode=${mode}&page=${page}&q=${encodeURIComponent(search)}`),
  });
  const lists = useQuery({
    queryKey: ["archived-lists", page, search],
    queryFn: () => apiGet<{ lists: ArchivedList[]; hasNext: boolean }>(`/api/lists/archive?page=${page}&q=${encodeURIComponent(search)}`),
    enabled: mode === "lists",
  });
  const unarchive = useMutation({
    mutationFn: (id: string) => apiSend(`/api/lists/${id}`, "PATCH", { archived: false }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["bootstrap"] });
      return client.invalidateQueries({ queryKey: ["archived-lists"] });
    },
  });
  const restore = useMutation({
    mutationFn: (id: string) => apiSend("/api/tasks/recovery", "POST", { id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["recovery"] }),
  });

  return (
    <main className="flex-1 overflow-auto p-5 sm:p-8">
      <h1 className="text-xl font-semibold">Archive and Trash</h1>
      <div className="my-4 flex gap-2" aria-label="Recovery categories">
        {(["archive", "trash", "lists"] as const).map((category) => (
          <button key={category} className={button + " aria-pressed:border-cu-purple aria-pressed:text-cu-purple"} aria-pressed={mode === category} onClick={() => { setMode(category); setPage(0); restore.reset(); }}>
            {category === "archive" ? "Archive" : category === "trash" ? "Trash" : "Archived lists"}
          </button>
        ))}
      </div>
      <input aria-label={mode === "lists" ? "Search archived lists" : "Search archived or trashed tasks"} placeholder={mode === "lists" ? "Search by list name" : "Search by task name"} className={button + " mb-4 bg-cu-panel"}
        value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
      {mode === "lists" ? <>
        {lists.isPending && <p>Loading archived lists…</p>}
        {(lists.isError || unarchive.isError) && <p role="alert">Could not load or restore the list.</p>}
        {lists.data?.lists.length === 0 && <p>No archived lists found.</p>}
        <ul className="divide-y divide-cu-border">
          {lists.data?.lists.map((list) => <li key={list.id} className="flex items-center justify-between gap-3 py-3">
            <div>
              <Link href={`/l/${list.id}`} className="font-medium hover:underline">{list.name}</Link>
              <p className="text-sm text-cu-text-secondary">{list.space.name}{list.folder ? ` / ${list.folder.name}` : ""}</p>
              <p className="text-xs text-cu-text-secondary">{list.archivedBy && `Archived by ${list.archivedBy} · `}{new Date(list.archivedAt).toLocaleString()}</p>
            </div>
            {canRestore && <button className={button} disabled={unarchive.isPending} onClick={() => unarchive.mutate(list.id)} aria-label={`Unarchive ${list.name}`}>Unarchive</button>}
          </li>)}
        </ul>
      </> : <>
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
      </>}
      {(page > 0 || (mode === "lists" ? lists.data?.hasNext : query.data?.hasNext)) && <div className="mt-4 flex gap-2">
        <button className={button} disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
        <button className={button} disabled={!(mode === "lists" ? lists.data?.hasNext : query.data?.hasNext)} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
    </main>
  );
}
