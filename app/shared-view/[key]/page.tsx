"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { ViewRenderer } from "@/components/views/special-views";
import type { ViewKind } from "@/lib/view-kind";
import { CalendarView, type CalendarTask } from "@/components/views/calendar-view";
import { GanttChart } from "@/components/views/gantt-view";
import type { ViewState } from "@/lib/view-state";

type SharedTask = Omit<CalendarTask, "listId" | "archived" | "assignees" | "status"> & {
  status: Omit<CalendarTask["status"], "id">; assigned?: boolean; mapLatitude?: number | null; mapLongitude?: number | null;
};
type SharedView = { name: string; type: ViewKind; tasks: SharedTask[]; embedUrl?: string | null;
  dependencies?: { id: string; blockerId: string; blockedId: string }[]; mindMap?: ViewState["mindMap"]; groupBy?: ViewState["groupBy"];
};

export default function SharedViewPage() {
  const { key } = useParams<{ key: string }>();
  const { data, isPending, isError } = useQuery({
    queryKey: ["shared-view", key],
    queryFn: () => apiGet<SharedView>(`/api/public/views/${encodeURIComponent(key)}`),
    retry: false,
  });
  return <main className="mx-auto min-h-dvh w-full max-w-6xl p-6 pt-12">
    {isPending && <p role="status">Loading shared view…</p>}
    {isError && <p role="alert">This shared view is unavailable.</p>}
    {data && <>
      <h1 className="text-xl font-semibold">{data.name}</h1>
      <p className="mb-4 mt-1 text-sm text-cu-text-secondary">Read-only task summary</p>
      {data.type === "CALENDAR" ? <CalendarView canSchedule={false} tasks={data.tasks.map((task) => ({
        ...task, listId: "", status: { ...task.status, id: "" }, assignees: [], archived: false,
      }))} /> : data.type === "GANTT" ? <GanttChart tasks={data.tasks} dependencies={data.dependencies ?? []} />
        : <ViewRenderer type={data.type} tasks={data.tasks} embedUrl={data.embedUrl} mindMap={data.mindMap} groupBy={data.groupBy} />}
    </>}
  </main>;
}
