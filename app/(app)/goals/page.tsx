"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";
import { isCompletedStatus } from "@/lib/task-status";
import type { listGoals } from "@/lib/workspace-goals";
import type { getWorkspaceTasks } from "@/lib/workspace-tasks";

type Goal = Awaited<ReturnType<typeof listGoals>>[number];
type GoalPatch = { progress?: number; archived?: boolean; addTaskId?: string; removeTaskId?: string };
const control = "rounded border border-cu-border bg-cu-panel px-2 py-1.5 text-sm disabled:opacity-50";

function GoalCard({ goal, editable }: { goal: Goal; editable: boolean }) {
  const client = useQueryClient();
  const [manage, setManage] = useState(false);
  const [progress, setProgress] = useState(goal.progress);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const update = useMutation({
    mutationFn: (patch: GoalPatch) => apiSend(`/api/workspace/goals/${goal.id}`, "PATCH", patch),
    onSuccess: () => client.invalidateQueries({ queryKey: ["goals"] }),
  });
  const tasks = useQuery({
    queryKey: ["goal-task-search", search], enabled: manage && !!search,
    queryFn: () => apiGet<Awaited<ReturnType<typeof getWorkspaceTasks>>>(`/api/workspace/tasks?${new URLSearchParams({ q: search })}`),
  });
  const linked = goal.tasks.length;
  const finished = goal.tasks.filter(({ task }) => isCompletedStatus(task.status.type)).length;
  const value = linked ? finished : goal.progress;
  const target = linked ? linked : goal.target;

  return <article className="rounded-xl border border-cu-border bg-cu-panel p-4">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h2 className="font-semibold">{goal.name}</h2>
        {goal.description && <p className="text-sm text-cu-text-secondary">{goal.description}</p>}
        {goal.dueDate && <p className="mt-1 text-xs text-cu-text-secondary">Due {String(goal.dueDate).slice(0, 10)}</p>}
      </div>
      {editable && <div className="flex gap-2">
        {!goal.archived && <button className={control} onClick={() => { setManage(!manage); setProgress(goal.progress); }}>{manage ? "Close goal settings" : "Manage goal"}</button>}
        <button className={control} disabled={update.isPending} onClick={() => update.mutate({ archived: !goal.archived })}>{goal.archived ? "Restore goal" : "Archive goal"}</button>
      </div>}
    </div>
    <p className="mt-3 text-sm">{linked ? `${finished} of ${linked} linked tasks closed` : `${goal.progress} of ${goal.target} ${goal.unit}`}</p>
    <progress aria-label={`${goal.name} progress`} value={Math.min(value, target)} max={target} className="w-full accent-cu-purple" />
    {!!linked && <ul className="mt-2 divide-y divide-cu-border">{goal.tasks.map(({ task }) => <li key={task.id} className="flex items-center justify-between gap-2 py-2 text-sm">
      <Link className="hover:underline" href={`/l/${task.listId}?task=${task.id}`}>{task.name} <span className="text-cu-text-secondary">· {task.status.name}</span></Link>
      {manage && <button className={control} aria-label={`Unlink ${task.name}`} onClick={() => update.mutate({ removeTaskId: task.id })}>Unlink</button>}
    </li>)}</ul>}
    {manage && <div className="mt-3 grid gap-3 border-t border-cu-border pt-3">
      {!linked && <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); update.mutate({ progress }); }}>
        <label className="grid gap-1 text-xs">Current progress<input className={control} required min={0} max={1_000_000_000} type="number" value={progress} onChange={(event) => setProgress(event.target.valueAsNumber || 0)} /></label>
        <button className={control} disabled={update.isPending}>Save progress</button>
      </form>}
      <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(term.trim()); }}>
        <label className="grid gap-1 text-xs">Find task to link<input className={control} value={term} maxLength={200} onChange={(event) => setTerm(event.target.value)} /></label>
        <button className={control}>Find tasks</button>
      </form>
      <ul className="max-h-40 divide-y divide-cu-border overflow-y-auto">{tasks.data?.tasks.filter((task) => !goal.tasks.some((item) => item.taskId === task.id)).map((task) => <li className="flex items-center justify-between gap-2 py-1 text-sm" key={task.id}>
        <span>{task.name} · {task.list.name}</span><button className={control} disabled={update.isPending} aria-label={`Link ${task.name}`} onClick={() => update.mutate({ addTaskId: task.id })}>Link</button>
      </li>)}</ul>
    </div>}
    {update.isError && <p role="alert" className="text-sm text-cu-urgent">Could not update this goal.</p>}
  </article>;
}

export default function GoalsPage() {
  const { currentUser, workspace } = useWorkspace();
  const editable = workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["goals", archived],
    queryFn: () => apiGet<Goal[]>(`/api/workspace/goals?archived=${archived}`),
  });
  const create = useMutation({
    mutationFn: (input: { name: string; unit: string; target: number; description: string; dueDate?: string }) =>
      apiSend("/api/workspace/goals", "POST", input),
    onSuccess: () => { setAdding(false); setArchived(false); void client.invalidateQueries({ queryKey: ["goals"] }); },
  });
  return <main className="flex-1 overflow-auto p-5 sm:p-8">
    <div className="mb-4 flex flex-wrap justify-between gap-2">
      <h1 className="text-xl font-semibold">Goals</h1>
      <div className="flex gap-2"><button className={control} aria-pressed={archived} onClick={() => setArchived(!archived)}>{archived ? "Show active goals" : "Show archived goals"}</button>
        {editable && <button className={control} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "New goal"}</button>}
      </div>
    </div>
    {adding && <form className="mb-4 grid max-w-lg gap-3 rounded-lg border border-cu-border bg-cu-panel p-4" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const due = String(fields.get("dueDate") ?? "");
      create.mutate({ name: String(fields.get("name")), description: String(fields.get("description")), unit: String(fields.get("unit")),
        target: Number(fields.get("target")), ...(due && { dueDate: new Date(due).toISOString() }) });
    }}>
      <label className="grid gap-1 text-sm">Goal name<input className={control} name="name" maxLength={160} required /></label>
      <label className="grid gap-1 text-sm">Description<textarea className={control} name="description" maxLength={4000} /></label>
      <div className="flex flex-wrap gap-2">
        <label className="grid gap-1 text-sm">Target<input className={control + " w-24"} name="target" type="number" min={1} max={1_000_000_000} defaultValue={1} required /></label>
        <label className="grid gap-1 text-sm">Unit<input className={control + " w-32"} name="unit" maxLength={40} defaultValue="items" required /></label>
        <label className="grid gap-1 text-sm">Due date<input className={control} name="dueDate" type="date" /></label>
      </div>
      <button className={control} disabled={create.isPending}>Create goal</button>
    </form>}
    {(query.isError || create.isError) && <p role="alert" className="text-sm text-cu-urgent">Could not complete the goal request.</p>}
    {query.isPending && <p>Loading goals…</p>}
    {query.data?.length === 0 && <p className="text-sm text-cu-text-secondary">No goals here.</p>}
    <div className="grid gap-3">{query.data?.map((goal) => <GoalCard key={goal.id} goal={goal} editable={editable} />)}</div>
  </main>;
}
