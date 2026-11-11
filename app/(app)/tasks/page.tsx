"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/components/workspace-context";
import { apiGet } from "@/lib/api";
import { StatusCircle } from "@/components/menus/status-control";
import type { getWorkspaceTasks } from "@/lib/workspace-tasks";

const control = "rounded border border-cu-border bg-cu-panel px-2 py-1.5 text-sm disabled:opacity-50";

function TaskExplorer() {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const search = useSearchParams();
  const lists = workspace.spaces.flatMap((space) => [...space.lists, ...space.folders.flatMap((folder) => folder.lists)]);
  const key = search.toString();
  const page = Number(search.get("page")) || 0;
  const query = useQuery({
    queryKey: ["workspace-tasks", key],
    queryFn: () => apiGet<Awaited<ReturnType<typeof getWorkspaceTasks>>>(`/api/workspace/tasks?${key}`),
  });

  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(search);
    if (name !== "page") next.delete("page");
    if (value) next.set(name, value);
    else next.delete(name);
    router.replace(next.size ? `/tasks?${next}` : "/tasks");
  }

  return <main className="flex-1 overflow-auto p-5 sm:p-8">
    <h1 className="text-xl font-semibold">All tasks</h1>
    <div className="my-4 flex flex-wrap items-end gap-3">
      <form className="flex items-end gap-2" key={search.get("q") ?? ""} onSubmit={(event) => {
        event.preventDefault();
        setFilter("q", String(new FormData(event.currentTarget).get("q") ?? "").trim());
      }}>
        <label className="grid gap-1 text-xs">Task name<input className={control} name="q" maxLength={200} defaultValue={search.get("q") ?? ""} /></label>
        <button className={control}>Search tasks</button>
      </form>
      <label className="grid gap-1 text-xs">List<select className={control} value={search.get("listId") ?? ""} onChange={(e) => setFilter("listId", e.target.value)}>
        <option value="">All lists</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs">Assignee<select className={control} value={search.get("assignee") ?? ""} onChange={(e) => setFilter("assignee", e.target.value)}>
        <option value="">Everyone</option><option value="unassigned">Unassigned</option>
        {workspace.members.map(({ user }) => <option key={user.id} value={user.id}>{user.name}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs">Task status<select className={control} value={search.get("status") ?? "all"} onChange={(e) => setFilter("status", e.target.value)}>
        <option value="all">All tasks</option><option value="open">Open</option><option value="closed">Closed</option><option value="overdue">Overdue</option>
      </select></label>
      <label className="grid gap-1 text-xs">Sort by<select className={control} value={search.get("sort") ?? "due"} onChange={(e) => setFilter("sort", e.target.value)}>
        <option value="due">Due date</option><option value="updated">Last updated</option><option value="name">Name</option>
      </select></label>
      {key && <Link className={control} href="/tasks">Clear filters</Link>}
    </div>
    {query.isPending && <p>Loading tasks…</p>}
    {query.isError && <p role="alert">Could not load tasks for these filters.</p>}
    {query.data?.tasks.length === 0 && <p className="text-sm text-cu-text-secondary">No tasks match your filters.</p>}
    <ul className="divide-y divide-cu-border">
      {query.data?.tasks.map((task) => <li key={task.id} className="flex items-center justify-between gap-3 py-3 text-sm">
        <Link className="flex min-w-0 items-center gap-2 hover:underline" href={`/l/${task.listId}?task=${task.id}`}>
          <StatusCircle status={task.status} className="shrink-0" />
          <span className="min-w-0"><span className="block truncate font-medium">{task.name}</span><span className="text-xs text-cu-text-secondary">
            {task.list.space.name} / {task.list.name}{task.parent ? ` / ${task.parent.name}` : ""} · {task.status.name}
          </span></span>
        </Link>
        <div className="shrink-0 text-right text-xs text-cu-text-secondary">
          <div>{task.assignees.map(({ user }) => user.name).join(", ") || "Unassigned"}</div>
          {task.dueDate && <time dateTime={String(task.dueDate)}>{new Date(task.dueDate).toLocaleDateString()}</time>}
        </div>
      </li>)}
    </ul>
    {(page > 0 || query.data?.hasNext) && <div className="mt-3 flex gap-2">
      <button className={control} disabled={page < 1} onClick={() => setFilter("page", String(page - 1))}>Previous</button>
      <button className={control} disabled={!query.data?.hasNext} onClick={() => setFilter("page", String(page + 1))}>Next</button>
    </div>}
  </main>;
}

export default function WorkspaceTasksPage() {
  return <Suspense fallback={<p className="p-5">Loading tasks…</p>}><TaskExplorer /></Suspense>;
}
