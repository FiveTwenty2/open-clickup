"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { CalendarView, type CalendarTask } from "@/components/views/calendar-view";
import { useWorkspace } from "@/components/workspace-context";
import { apiGet } from "@/lib/api";

export default function WorkspaceCalendar() {
  const { workspace, currentUser } = useWorkspace();
  const router = useRouter();
  const [listId, setListId] = useState("");
  const canWrite = workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");
  const lists = workspace.spaces.flatMap((space) =>
    [...space.lists, ...space.folders.flatMap((folder) => folder.lists)]
      .map((list) => ({ id: list.id, name: `${space.name} / ${list.name}` })),
  );
  const activeListId = lists.some((list) => list.id === listId) ? listId : "";
  const query = useQuery({
    queryKey: ["workspace-calendar", activeListId],
    queryFn: () => apiGet<{ tasks: CalendarTask[] }>(`/api/workspace/calendar?list=${encodeURIComponent(activeListId)}`),
  });
  return <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
    <header className="flex flex-wrap items-center gap-4 border-b border-cu-border px-4 py-3">
      <h1 className="text-lg font-semibold">Workspace calendar</h1>
      <select aria-label="Calendar list" value={activeListId} onChange={(event) => setListId(event.target.value)}
        className="rounded border border-cu-border bg-cu-panel px-2 py-1 text-sm">
        <option value="">All active lists</option>
        {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
      </select>
      {query.isFetching && <span role="status" className="text-xs text-cu-text-secondary">Loading tasks…</span>}
      {query.isError && <span role="alert" className="text-xs text-cu-urgent">Could not load calendar tasks.</span>}
    </header>
    <CalendarView tasks={query.data?.tasks ?? []} listId={activeListId || undefined} lists={lists} canSchedule={canWrite}
      onOpenTask={(taskId, taskListId) => router.push(`/l/${taskListId}?task=${taskId}`)} />
  </main>;
}
