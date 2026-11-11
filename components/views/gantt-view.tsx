"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  eachDayOfInterval,
  differenceInCalendarDays,
  format,
  isToday,
  isWeekend,
  startOfDay,
  addDays,
} from "date-fns";
import { TaskContextMenu } from "@/components/task/task-context-menu";
import { cn } from "@/lib/utils";
import type { ListData, TaskWithRelations } from "@/lib/queries";
import type { TaskPatch } from "@/lib/tasks";
import { useUpdateTask } from "@/lib/hooks";
import { StatusCircle } from "@/components/menus/status-control";
import { AvatarStack } from "@/components/ui/avatar";

function noonISO(d: Date): string {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x.toISOString();
}

const DAY_W = 34;
const NAME_W = 260;
const ROW_H = 39; // timeline cell (38) + row border (1)
const WINDOW_DAYS = 42;

type Geo = { cy: number; left: number; right: number; visible: boolean };
type GanttTask = Pick<TaskWithRelations, "id" | "name" | "startDate" | "dueDate" | "milestone"> & {
  status: Pick<TaskWithRelations["status"], "color" | "type">;
  assignees?: TaskWithRelations["assignees"];
};

function barGeometry(task: GanttTask, start: Date, rowIndex: number, days: number): Geo {
  const s = task.startDate
    ? startOfDay(new Date(task.startDate))
    : task.dueDate
      ? startOfDay(new Date(task.dueDate))
      : null;
  const e = task.dueDate ? startOfDay(new Date(task.dueDate)) : s;
  const offset = s ? differenceInCalendarDays(s, start) : 0;
  const span = s && e ? differenceInCalendarDays(e, s) + 1 : 0;
  return {
    cy: rowIndex * ROW_H + ROW_H / 2,
    left: Math.max(0, offset) * DAY_W + 3,
    right: Math.min(days, offset + span) * DAY_W - 3,
    visible: span > 0 && offset < days && offset + span > 0,
  };
}

export function GanttView({
  data,
  onOpenTask,
}: {
  data: ListData;
  onOpenTask: (id: string) => void;
}) {
  const update = useUpdateTask(data.list.id);
  const taskById = new Map(data.tasks.map((task) => [task.id, task]));
  return <GanttChart tasks={data.tasks} dependencies={data.dependencies} onOpenTask={onOpenTask}
    onReschedule={(taskId, patch) => update.mutate({ taskId, patch })}
    wrapRow={(task, row) => <TaskContextMenu task={taskById.get(task.id)!} statuses={data.list.statuses}
      onOpen={() => onOpenTask(task.id)}><div>{row}</div></TaskContextMenu>} />;
}

export function GanttChart({ tasks, dependencies, onOpenTask, onReschedule, wrapRow }: {
  tasks: GanttTask[];
  dependencies: Pick<ListData["dependencies"][number], "id" | "blockerId" | "blockedId">[];
  onOpenTask?: (id: string) => void;
  onReschedule?: (id: string, patch: TaskPatch) => void;
  wrapRow?: (task: GanttTask, row: ReactNode) => ReactNode;
}) {
  const arrowId = useId();
  const [cursor, setCursor] = useState<Date | null>(null);

  const { start, days } = useMemo(() => {
    const dates: Date[] = [];
    for (const t of tasks) {
      if (t.startDate) dates.push(new Date(t.startDate));
      if (t.dueDate) dates.push(new Date(t.dueDate));
    }
    const today = startOfDay(new Date());
    let min = today;
    let max = dates.length ? today : addDays(today, 14);
    for (const date of dates) {
      if (date < min) min = date;
      if (date > max) max = date;
    }
    min = startOfDay(addDays(min < today ? min : today, -3));
    max = startOfDay(addDays(max > today ? max : today, 7));
    const broad = differenceInCalendarDays(max, min) >= WINDOW_DAYS;
    const start = cursor ?? (broad ? addDays(today, -3) : min);
    const end = cursor || broad ? addDays(start, WINDOW_DAYS - 1) : max;
    return { start, days: eachDayOfInterval({ start, end }) };
  }, [tasks, cursor]);

  // bar geometry per task (for drawing dependency arrows)
  const geo = useMemo(() => {
    const map = new Map<string, Geo>();
    tasks.forEach((t, i) => map.set(t.id, barGeometry(t, start, i, days.length)));
    return map;
  }, [tasks, start, days.length]);

  const arrows = useMemo(() => {
    return dependencies
      .map((d) => {
        const from = geo.get(d.blockerId);
        const to = geo.get(d.blockedId);
        if (!from || !to || !from.visible || !to.visible) return null;
        return { id: d.id, x1: from.right, y1: from.cy, x2: to.left, y2: to.cy };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }, [dependencies, geo]);

  // group day columns by month for the header
  const months = useMemo(() => {
    const out: { label: string; span: number }[] = [];
    for (const d of days) {
      const label = format(d, "MMMM yyyy");
      const last = out[out.length - 1];
      if (last && last.label === label) last.span += 1;
      else out.push({ label, span: 1 });
    }
    return out;
  }, [days]);

  return (
    <div role="region" aria-label="Gantt chart" className="flex-1 overflow-auto">
      <div className="sticky left-0 flex flex-wrap items-center gap-2 p-2 text-xs">
        <button className="rounded border border-cu-border px-2 py-1 hover:bg-cu-hover"
          onClick={() => setCursor(addDays(start, -WINDOW_DAYS))}>Previous period</button>
        <button className="rounded border border-cu-border px-2 py-1 hover:bg-cu-hover"
          onClick={() => setCursor(addDays(start, WINDOW_DAYS))}>Next period</button>
        <button className="rounded border border-cu-border px-2 py-1 hover:bg-cu-hover"
          onClick={() => setCursor(startOfDay(new Date()))}>Today</button>
        <input type="date" aria-label="Go to Gantt date" className="rounded border border-cu-border bg-cu-panel px-2 py-1"
          value={format(start, "yyyy-MM-dd")} onChange={(event) => {
            if (event.target.value) setCursor(startOfDay(new Date(event.target.value + "T12:00:00")));
          }} />
      </div>
      <div className="inline-block min-w-full">
        {/* header */}
        <div className="sticky top-0 z-20 flex bg-cu-bg">
          <div
            className="sticky left-0 z-30 shrink-0 border-b border-r border-cu-border bg-cu-bg"
            style={{ width: NAME_W }}
          >
            <div className="flex h-[44px] items-end px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-cu-text-tertiary">
              Name
            </div>
          </div>
          <div>
            {/* month row */}
            <div className="flex border-b border-cu-border">
              {months.map((m, i) => (
                <div
                  key={i}
                  className="shrink-0 px-2 py-1 text-[11px] font-semibold text-cu-text-secondary"
                  style={{ width: m.span * DAY_W }}
                >
                  {m.label}
                </div>
              ))}
            </div>
            {/* day row */}
            <div className="flex border-b border-cu-border">
              {days.map((d) => (
                <div
                  key={+d}
                  className={cn(
                    "shrink-0 text-center text-[10px] leading-tight",
                    isWeekend(d) ? "bg-cu-sidebar/50 text-cu-text-tertiary" : "text-cu-text-secondary",
                  )}
                  style={{ width: DAY_W }}
                >
                  <div className="pt-0.5">{format(d, "EEEEE")}</div>
                  <div className={cn(isToday(d) && "mx-auto flex h-4 w-4 items-center justify-center rounded-full bg-cu-purple text-white")}>
                    {format(d, "d")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* rows */}
        <div className="relative">
          {tasks.map((task) => {
            const row = <GanttRow
              task={task}
              start={start}
              days={days}
              onOpenTask={onOpenTask}
              onReschedule={onReschedule}
            />;
            return <div key={task.id}>{wrapRow ? wrapRow(task, row) : row}</div>;
          })}
          {arrows.length > 0 && (
            <svg
              role="img" aria-label="Task dependencies"
              className="pointer-events-none absolute top-0 z-[5] overflow-visible"
              style={{ left: NAME_W, width: days.length * DAY_W, height: tasks.length * ROW_H }}
            >
              <defs>
                <marker
                  id={arrowId}
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6 Z" fill="#9aa1ad" />
                </marker>
              </defs>
              {arrows.map((a) => {
                const gap = 18;
                const d = `M ${a.x1} ${a.y1} C ${a.x1 + gap} ${a.y1}, ${a.x2 - gap} ${a.y2}, ${a.x2 - 2} ${a.y2}`;
                return (
                  <path
                    key={a.id}
                    d={d}
                    fill="none"
                    stroke="#9aa1ad"
                    strokeWidth={1.5}
                    markerEnd={`url(#${arrowId})`}
                  />
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

type DragMode = "move" | "resize-start" | "resize-end";

function GanttRow({
  task,
  start,
  days,
  onOpenTask,
  onReschedule,
}: {
  task: GanttTask;
  start: Date;
  days: Date[];
  onOpenTask?: (id: string) => void;
  onReschedule?: (taskId: string, patch: TaskPatch) => void;
}) {
  const s = task.startDate ? startOfDay(new Date(task.startDate)) : task.dueDate ? startOfDay(new Date(task.dueDate)) : null;
  const e = task.dueDate ? startOfDay(new Date(task.dueDate)) : s;

  const baseOffset = s ? differenceInCalendarDays(s, start) : 0;
  const baseSpan = s && e ? differenceInCalendarDays(e, s) + 1 : 0;

  const [drag, setDrag] = useState<{ mode: DragMode; dd: number } | null>(null);
  const suppressClick = useRef(false);

  // live preview geometry while dragging
  let offset = baseOffset;
  let span = baseSpan;
  if (drag) {
    if (drag.mode === "move") offset = baseOffset + drag.dd;
    else if (drag.mode === "resize-end") span = Math.max(1, baseSpan + drag.dd);
    else {
      offset = baseOffset + Math.min(drag.dd, baseSpan - 1);
      span = Math.max(1, baseSpan - drag.dd);
    }
  }

  function beginDrag(mode: DragMode, ev: React.PointerEvent) {
    if (ev.button !== 0 || !onReschedule) return;
    if (!s || !e) return;
    ev.preventDefault();
    ev.stopPropagation();
    const startX = ev.clientX;
    let moved = false;
    const onMove = (m: PointerEvent) => {
      const dd = Math.round((m.clientX - startX) / DAY_W);
      if (Math.abs(m.clientX - startX) > 3) moved = true;
      setDrag({ mode, dd });
    };
    const onUp = (u: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const dd = Math.round((u.clientX - startX) / DAY_W);
      setDrag(null);
      if (!moved || dd === 0) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      commit(mode, dd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function commit(mode: DragMode, dd: number) {
    if (!s || !e) return;
    const patch: TaskPatch = {};
    if (mode === "move") {
      if (task.startDate) patch.startDate = noonISO(addDays(s, dd));
      if (task.dueDate) patch.dueDate = noonISO(addDays(e, dd));
      if (!task.startDate && !task.dueDate) patch.dueDate = noonISO(addDays(e, dd));
    } else if (mode === "resize-end") {
      const newEnd = addDays(e, dd);
      patch.dueDate = noonISO(newEnd < s ? s : newEnd);
    } else {
      const newStart = addDays(s, dd);
      patch.startDate = noonISO(newStart > e ? e : newStart);
    }
    onReschedule?.(task.id, patch);
  }

  const clippedStart = Math.max(0, offset);
  const clippedSpan = Math.min(days.length, offset + span) - clippedStart;
  return (
    <div className="flex border-b border-cu-border/60 hover:bg-cu-hover/40">
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-cu-border bg-cu-bg px-3"
        style={{ width: NAME_W }}
      >
        {task.milestone ? <span aria-label="Milestone" role="img" className="text-sm text-cu-purple">◆</span> : <StatusCircle status={task.status} size={14} />}
        {onOpenTask ? <button onClick={() => onOpenTask(task.id)} className="truncate text-left text-[13px] hover:text-cu-purple">
          {task.name}
        </button> : <span className="truncate text-[13px]">{task.name}</span>}
      </div>
      <div className="relative" style={{ width: days.length * DAY_W, height: 38 }}>
        {/* weekend shading */}
        <div className="absolute inset-0 flex">
          {days.map((d) => (
            <div
              key={+d}
              className={cn("shrink-0 border-r border-cu-border/30", isWeekend(d) && "bg-cu-sidebar/40")}
              style={{ width: DAY_W }}
            />
          ))}
        </div>
        {span > 0 && clippedSpan > 0 && (
          <div
            className={cn(
              "group/bar absolute top-1/2 flex h-5 -translate-y-1/2 cursor-grab items-center gap-1 rounded-full px-2 text-[11px] font-medium text-white shadow-sm hover:brightness-95 active:cursor-grabbing",
              drag && "z-10 ring-2 ring-white/60",
            )}
            style={{
              left: clippedStart * DAY_W + 3,
              width: clippedSpan * DAY_W - 6,
              backgroundColor: task.status.color,
            }}
            onPointerDown={(ev) => beginDrag("move", ev)}
            onClick={() => {
              if (suppressClick.current) return;
              onOpenTask?.(task.id);
            }}
          >
            {/* left resize handle */}
            {onReschedule && offset >= 0 && <span
              onPointerDown={(ev) => beginDrag("resize-start", ev)}
              className="absolute left-0 top-0 h-full w-2 cursor-ew-resize rounded-l-full opacity-0 group-hover/bar:opacity-100"
            />}
            <span className="truncate">{task.name}</span>
            {!!task.assignees?.length && (
              <span className="ml-auto shrink-0">
                <AvatarStack users={task.assignees.map((a) => a.user)} size="xs" max={2} />
              </span>
            )}
            {/* right resize handle */}
            {onReschedule && offset + span <= days.length && <span
              onPointerDown={(ev) => beginDrag("resize-end", ev)}
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-full opacity-0 group-hover/bar:opacity-100"
            />}
          </div>
        )}
      </div>
    </div>
  );
}
