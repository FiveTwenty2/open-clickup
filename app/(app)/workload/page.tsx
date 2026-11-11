"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, addWeeks, differenceInBusinessDays, format, startOfDay, startOfWeek } from "date-fns";
import { apiGet } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";

type WorkloadTask = {
  id: string; name: string; listId: string; timeEstimate: number | null; startDate: string | null; dueDate: string | null;
  list: { name: string }; assignees: { userId: string }[];
};
type Row = { name: string; tasks: { task: WorkloadTask; minutes: number }[] };
const control = "rounded border border-cu-border bg-cu-panel px-3 py-1.5 text-sm";
const hours = (minutes: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(minutes / 60);

function estimateForWeek(task: WorkloadTask, start: Date, end: Date) {
  const estimate = Math.max(0, task.timeEstimate ?? 0);
  const first = startOfDay(new Date((task.startDate ?? task.dueDate)!));
  const last = startOfDay(new Date((task.dueDate ?? task.startDate)!));
  if (first >= last) return last >= start && last < end ? estimate : null;
  const afterLast = addDays(last, 1);
  const totalDays = differenceInBusinessDays(afterLast, first);
  if (!totalDays) return last >= start && last < end ? estimate : null;
  const overlapStart = first > start ? first : start;
  const overlapEnd = afterLast < end ? afterLast : end;
  const overlap = differenceInBusinessDays(overlapEnd, overlapStart);
  return overlap > 0 ? estimate * overlap / totalDays : null;
}

export default function WorkloadPage() {
  const { workspace } = useWorkspace();
  const [cursor, setCursor] = useState(() => new Date());
  const [capacity, setCapacity] = useState("40");
  const [listId, setListId] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const start = startOfWeek(cursor, { weekStartsOn: 1 });
  const end = addWeeks(start, 1);
  const lists = workspace.spaces.flatMap((space) => [...space.lists, ...space.folders.flatMap((folder) => folder.lists)]);
  const params = new URLSearchParams({ from: start.toISOString(), to: end.toISOString(), listId });
  const query = useQuery({
    queryKey: ["workload", params.toString()],
    queryFn: () => apiGet<{ tasks: WorkloadTask[] }>(`/api/workspace/workload?${params}`),
  });
  const available = Number(capacity);
  const rows = new Map<string, Row>(workspace.members.filter((member) => member.role !== "GUEST")
    .map((member) => [member.userId, { name: member.user.name, tasks: [] }]));
  rows.set("unassigned", { name: "Unassigned", tasks: [] });
  for (const task of query.data?.tasks ?? []) {
    const people = task.assignees.filter((assignee) => rows.has(assignee.userId));
    const ids = people.length ? people.map((person) => person.userId) : ["unassigned"];
    const estimate = estimateForWeek(task, start, end);
    if (estimate === null) continue;
    const minutes = estimate / ids.length;
    for (const id of ids) rows.get(id)?.tasks.push({ task, minutes });
  }

  return <main className="flex-1 overflow-auto p-5 sm:p-8">
    <h1 className="text-xl font-semibold">Workload</h1>
    <p className="mt-1 text-sm text-cu-text-secondary">Estimates for tasks with a date range are spread across weekdays and split among assignees. Single-date tasks count on their scheduled date.</p>
    <div className="my-4 flex flex-wrap items-end gap-2">
      <div className="flex items-center gap-2">
        <button className={control} onClick={() => setCursor((date) => addWeeks(date, -1))}>Previous week</button>
        <button className={control} onClick={() => setCursor(new Date())}>This week</button>
        <button className={control} onClick={() => setCursor((date) => addWeeks(date, 1))}>Next week</button>
        <time dateTime={format(start, "yyyy-MM-dd")} className="text-sm font-medium">Week of {format(start, "MMM d, yyyy")}</time>
      </div>
      <label className="grid gap-1 text-xs">List
        <select aria-label="Workload list" className={control} value={listId} onChange={(event) => setListId(event.target.value)}>
          <option value="">All active lists</option>
          {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs">Weekly capacity per person (hours)
        <input className={control + " w-28"} type="number" min={1} max={168} step={0.5} value={capacity}
          onChange={(event) => setCapacity(event.target.value)} />
      </label>
      <label className="flex items-center gap-2 p-1.5 text-sm"><input type="checkbox" checked={showEmpty} onChange={(event) => setShowEmpty(event.target.checked)} /> Show people without tasks</label>
    </div>
    {query.isPending && <p role="status">Loading workload…</p>}
    {query.isError && <p role="alert">Could not load the workload.</p>}
    {query.data && <>
      {![...rows.values()].some((row) => row.tasks.length) && !showEmpty && <p>No open tasks scheduled for this week.</p>}
      <div className="grid gap-3">
        {[...rows].filter(([, row]) => showEmpty || row.tasks.length).map(([id, row]) => {
          const total = row.tasks.reduce((sum, item) => sum + item.minutes, 0);
          const unestimated = row.tasks.filter(({ task }) => task.timeEstimate === null).length;
          const comparison = id !== "unassigned" && available >= 1 && available <= 168;
          const used = comparison ? total / (available * 60) : 0;
          return <section key={id} className="rounded border border-cu-border px-4 py-3">
            <h2 className="font-semibold">{row.name}</h2>
            <p className="text-sm text-cu-text-secondary">
              {row.tasks.length} {row.tasks.length === 1 ? "task" : "tasks"} · {hours(total)} h estimated
              {comparison && ` / ${available} h capacity`}{unestimated > 0 && ` · ${unestimated} without estimates`}
              {comparison && used > 1 && ` · ${hours(total - available * 60)} h over capacity`}
            </p>
            {comparison && <progress aria-label={`${row.name} capacity used`} className="mt-1 w-full accent-cu-purple" max={1} value={Math.min(1, used)} />}
            {!!row.tasks.length && <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-cu-purple">View tasks</summary>
              <ul className="mt-1 divide-y divide-cu-border">
                {row.tasks.map(({ task, minutes }) => <li key={task.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <Link href={`/l/${task.listId}?task=${task.id}`} className="hover:underline">{task.name}</Link>
                  <span className="text-xs text-cu-text-secondary">{task.list.name} · {task.timeEstimate === null ? "No estimate" : `${hours(minutes)} h`}</span>
                </li>)}
              </ul>
            </details>}
          </section>;
        })}
      </div>
    </>}
  </main>;
}
