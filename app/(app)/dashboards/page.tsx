"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { encodeCsv } from "@/lib/csv";
import { useWorkspace } from "@/components/workspace-context";
import type { getDashboard } from "@/lib/dashboard";

const panel = "rounded-xl border border-cu-border bg-cu-panel p-4";
const control = "rounded border border-cu-border bg-cu-panel px-2 py-1.5 text-sm";

function hours(seconds: number) {
  return (seconds / 3600).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function DashboardsPage() {
  const { workspace } = useWorkspace();
  const [listId, setListId] = useState("");
  const [userId, setUserId] = useState("");
  const [days, setDays] = useState("7");
  const lists = workspace.spaces.flatMap((space) => [...space.lists, ...space.folders.flatMap((folder) => folder.lists)]);
  const names = new Map(lists.map((list) => [list.id, list.name]));
  const members = new Map(workspace.members.map(({ user }) => [user.id, user.name]));
  const query = useQuery({
    queryKey: ["dashboard", listId, userId, days],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - Number(days) + 1);
      from.setHours(0, 0, 0, 0);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), listId, userId });
      return apiGet<Awaited<ReturnType<typeof getDashboard>>>(`/api/dashboard?${params}`);
    },
  });
  const data = query.data;

  function downloadTime() {
    if (!data) return;
    const csv = encodeCsv([
      ["Member", "Entries", "Hours", "Seconds"],
      ...data.timeByUser.map((entry) => [members.get(entry.userId) ?? "Former member", entry.entries, entry.seconds / 3600, entry.seconds]),
    ]);
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "time-report.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="flex-1 overflow-auto p-5 sm:p-8">
      <h1 className="text-xl font-semibold">Workspace dashboard</h1>
      <div className="my-4 flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs">List
          <select aria-label="List" className={control} value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">All lists</option>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs">Member
          <select aria-label="Member" className={control} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Everyone</option>
            {[...members].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </div>
      {query.isPending && <p>Loading dashboard…</p>}
      {query.isError && <p role="alert">Could not load the dashboard.</p>}
      {data && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Open tasks", data.openCount], ["Closed tasks", data.closedCount],
            ["Overdue", data.overdueCount], ["Unassigned open tasks", data.unassignedCount],
          ].map(([label, count]) => <section className={panel} key={label}><h2 className="text-sm text-cu-text-secondary">{label}</h2><p className="mt-2 text-3xl font-semibold">{count}</p></section>)}
        </div>
        <div className="my-4 grid gap-4 lg:grid-cols-2">
          <section className={panel}>
            <h2 className="mb-2 font-semibold">Due tasks</h2>
            {!data.upcoming.length && <p className="text-sm text-cu-text-secondary">No open tasks with due dates.</p>}
            <ul className="divide-y divide-cu-border">
              {data.upcoming.map((task) => <li className="flex items-center justify-between gap-3 py-2 text-sm" key={task.id}>
                <Link className="min-w-0 hover:underline" href={`/l/${task.listId}?task=${task.id}`}><span className="block truncate">{task.name}</span><span className="text-xs text-cu-text-secondary">{task.list.name}</span></Link>
                {task.dueDate && <time className="shrink-0" dateTime={String(task.dueDate)}>{new Date(task.dueDate).toLocaleDateString()}</time>}
              </li>)}
            </ul>
          </section>
          <section className={panel}>
            <h2 className="mb-2 font-semibold">List progress</h2>
            {!data.lists.length && <p className="text-sm text-cu-text-secondary">No tasks in this selection.</p>}
            {data.lists.map((list) => <div className="py-2" key={list.listId}>
              <div className="flex justify-between gap-2 text-sm"><Link className="hover:underline" href={`/l/${list.listId}`}>{names.get(list.listId)}</Link><span>{list.closed} of {list.open + list.closed} closed</span></div>
              <progress className="w-full accent-cu-purple" aria-label={`${names.get(list.listId)} progress`} value={list.closed} max={list.open + list.closed} />
            </div>)}
          </section>
        </div>
        <section className={panel}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="font-semibold">Time report</h2><p className="text-sm text-cu-text-secondary">{hours(data.trackedSeconds)} hours logged</p></div>
            <div className="flex items-end gap-2">
              <label className="grid gap-1 text-xs">Reporting period
                <select aria-label="Reporting period" className={control} value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
                </select>
              </label>
              <button className={control} onClick={downloadTime}>Export time CSV</button>
            </div>
          </div>
          <ul className="mt-3 divide-y divide-cu-border">
            {data.timeByUser.map((entry) => <li className="flex justify-between py-2 text-sm" key={entry.userId}>
              <span>{members.get(entry.userId) ?? "Former member"}</span><span>{hours(entry.seconds)} h · {entry.entries} entries</span>
            </li>)}
          </ul>
        </section>
      </>}
    </main>
  );
}
