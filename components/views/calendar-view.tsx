"use client";

import { useMemo, useState } from "react";
import {
  addDays, addMinutes, addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, endOfWeek,
  format, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek,
} from "date-fns";
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskWithRelations } from "@/lib/queries";
import { StatusCircle } from "@/components/menus/status-control";
import { useCreateTask, useUpdateTask } from "@/lib/hooks";
import { useWorkspace } from "@/components/workspace-context";

const modes = { day: "Day", four: "4 days", week: "Week", month: "Month" } as const;
type Mode = keyof typeof modes;
export type CalendarTask = Pick<TaskWithRelations, "id" | "name" | "listId" | "parentId" | "startDate" | "dueDate"> & {
  status: Pick<TaskWithRelations["status"], "name" | "color" | "type">;
  assignees: { userId: string }[];
};
const keyOf = (date: Date) => format(date, "yyyy-MM-dd");
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const weekOptions = { weekStartsOn: 1 as const };
const control = "rounded border border-cu-border px-2.5 py-1 text-xs hover:bg-cu-hover";

function dateOnDay(task: CalendarTask, day: string) {
  return [task.startDate, task.dueDate].find((value) => value && keyOf(new Date(value)) === day);
}

export function CalendarView({
  tasks: source, listId, onOpenTask, canSchedule, lists = [],
}: {
  tasks: CalendarTask[];
  listId?: string;
  lists?: { id: string; name: string }[];
  onOpenTask: (id: string, listId: string) => void;
  canSchedule: boolean;
}) {
  const { currentUser } = useWorkspace();
  const [cursor, setCursor] = useState(() => new Date());
  const [mode, setMode] = useState<Mode>("month");
  const [timeGrid, setTimeGrid] = useState(false);
  const [mine, setMine] = useState(false);
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [expandedDay, setExpandedDay] = useState("");
  const [newDay, setNewDay] = useState("");
  const [name, setName] = useState("");
  const [time, setTime] = useState("");
  const [destination, setDestination] = useState("");
  const createListId = listId ?? (destination || lists[0]?.id);
  const update = useUpdateTask(listId);
  const create = useCreateTask(createListId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const days = useMemo(() => {
    if (mode === "month") return eachDayOfInterval({
      start: startOfWeek(startOfMonth(cursor), weekOptions), end: endOfWeek(endOfMonth(cursor), weekOptions),
    });
    if (mode === "week") return eachDayOfInterval({
      start: startOfWeek(cursor, weekOptions), end: endOfWeek(cursor, weekOptions),
    });
    return eachDayOfInterval({ start: startOfDay(cursor), end: addDays(startOfDay(cursor), mode === "four" ? 3 : 0) });
  }, [cursor, mode]);

  const tasks = source.filter((task) => showSubtasks || !task.parentId)
    .filter((task) => !mine || task.assignees.some((assignee) => assignee.userId === currentUser.id));
  const events = new Map(days.map((day) => [keyOf(day), [] as CalendarTask[]]));
  const unscheduled: CalendarTask[] = [];
  const today = startOfDay(new Date());
  const overdue: CalendarTask[] = [];
  for (const task of tasks) {
    if (!task.startDate && !task.dueDate) { unscheduled.push(task); continue; }
    if (task.dueDate && new Date(task.dueDate) < today && !["CLOSED", "DONE"].includes(task.status.type)) overdue.push(task);
    const first = startOfDay(new Date((task.startDate ?? task.dueDate)!));
    const last = startOfDay(new Date((task.dueDate ?? task.startDate)!));
    const from = Math.max(0, differenceInCalendarDays(first < last ? first : last, days[0]));
    const to = Math.min(days.length - 1, differenceInCalendarDays(first > last ? first : last, days[0]));
    for (let i = from; i <= to; i++) events.get(keyOf(days[i]))?.push(task);
  }
  const timed = mode !== "month" && timeGrid;
  const columns = mode === "day" ? 1 : mode === "four" ? 4 : 7;
  const title = mode === "month" ? format(cursor, "MMMM yyyy") : mode === "day" ? format(cursor, "EEEE, MMMM d, yyyy")
    : `${format(days[0], "MMM d")} – ${format(days.at(-1)!, "MMM d, yyyy")}`;

  function step(direction: number) {
    setCursor((date) => mode === "month" ? addMonths(date, direction) : addDays(date, direction * columns));
  }

  function onDragEnd(event: DragEndEvent) {
    const item = event.active.data.current as { task: CalendarTask; day?: string } | undefined;
    const slot = event.over?.data.current as { date: string; hour?: number } | undefined;
    const target = days.find((day) => keyOf(day) === slot?.date);
    if (!item || !target || !slot || !canSchedule) return;
    if (item.day === slot.date && slot.hour === undefined) return;
    if (!item.day) {
      const due = new Date(target);
      due.setHours(slot.hour ?? 12, 0, 0, 0);
      update.mutate({ taskId: item.task.id, patch: { dueDate: due.toISOString() } });
      return;
    }
    const delta = differenceInCalendarDays(target, new Date(item.day + "T00:00:00"));
    const { startDate, dueDate } = item.task;
    const anchor = dateOnDay(item.task, item.day);
    let minutes = 0;
    if (slot.hour !== undefined && anchor) {
      const shifted = addDays(new Date(anchor), delta);
      minutes = slot.hour * 60 - shifted.getHours() * 60 - shifted.getMinutes();
    }
    const shift = (date: Date) => addMinutes(addDays(new Date(date), delta), minutes).toISOString();
    update.mutate({ taskId: item.task.id, patch: {
      ...(startDate && { startDate: shift(startDate) }),
      ...(dueDate && { dueDate: shift(dueDate) }),
    } });
  }

  function begin(day: string, hour?: number) {
    setNewDay(day);
    setName("");
    setTime(hour === undefined ? "" : `${String(hour).padStart(2, "0")}:00`);
    create.reset();
  }

  return (
    <section aria-label="Task calendar" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button aria-label="Previous period" onClick={() => step(-1)} className={control}><ChevronLeft className="h-4 w-4" /></button>
        <button aria-label="Next period" onClick={() => step(1)} className={control}><ChevronRight className="h-4 w-4" /></button>
        <button className={control} onClick={() => setCursor(new Date())}>Today</button>
        <input type="date" aria-label="Go to calendar date" className={control + " bg-cu-panel"} value={keyOf(cursor)}
          onChange={(event) => { if (event.target.value) setCursor(new Date(event.target.value + "T12:00:00")); }} />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Me mode</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showSubtasks} onChange={(e) => setShowSubtasks(e.target.checked)} /> Show subtasks</label>
        {mode !== "month" && <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={timeGrid} onChange={(event) => setTimeGrid(event.target.checked)} /> Time grid
        </label>}
        <button className={control} aria-expanded={showQueue} onClick={() => setShowQueue(!showQueue)}>Unscheduled and overdue</button>
        <div className="ml-auto flex gap-1" aria-label="Calendar period">
          {(Object.keys(modes) as Mode[]).map((period) => (
            <button key={period} onClick={() => setMode(period)} aria-pressed={mode === period}
              className={control + " aria-pressed:bg-cu-purple aria-pressed:text-white"}>{modes[period]}</button>
          ))}
        </div>
      </div>
      {update.isError && <p role="alert" className="px-4 text-sm text-cu-urgent">Could not reschedule the task.</p>}
      {newDay && <form aria-label="Schedule a task" className="flex flex-wrap items-center gap-2 border-t border-cu-border px-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!createListId || !name.trim() || create.isPending) return;
          const dueDate = new Date(newDay + "T" + (time || "12:00")).toISOString();
          create.mutate({ listId: createListId, name: name.trim(), dueDate }, { onSuccess: () => setNewDay("") });
        }}>
        <span className="text-sm">{format(new Date(newDay + "T12:00:00"), "MMM d, yyyy")}</span>
        <input aria-label="Scheduled task name" autoFocus className={control + " bg-cu-panel"} value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" />
        {!listId && <select aria-label="List for new task" className={control + " bg-cu-panel"} value={createListId ?? ""} onChange={(e) => setDestination(e.target.value)}>
          {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>}
        {mode !== "month" && <input aria-label="Due time" type="time" className={control + " bg-cu-panel"} value={time} onChange={(e) => setTime(e.target.value)} />}
        <button className={control} disabled={!name.trim() || create.isPending}>Create task</button>
        <button type="button" className={control} onClick={() => setNewDay("")}>Cancel</button>
        {create.isError && <p role="alert">Could not create the task.</p>}
      </form>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 flex-wrap sm:flex-nowrap">
          <div className="min-w-0 flex-1 overflow-auto">
            <div className={cn("grid", columns === 7 && "min-w-[620px]")} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {days.map((day) => {
                const key = keyOf(day);
                const rows = events.get(key) ?? [];
                const byHour = new Map<number, CalendarTask[]>();
                const untimed: CalendarTask[] = [];
                for (const task of rows) {
                  const date = timed && dateOnDay(task, key);
                  if (!date) { untimed.push(task); continue; }
                  const hour = new Date(date).getHours();
                  const entries = byHour.get(hour) ?? [];
                  entries.push(task);
                  byHour.set(hour, entries);
                }
                const renderTask = (task: CalendarTask) => (
                  <DraggableTask key={task.id} task={task} day={key} canSchedule={canSchedule} showTime={mode !== "month"} onOpen={() => onOpenTask(task.id, task.listId)} />
                );
                const expanded = expandedDay === key || mode !== "month";
                return (
                  <DayCell key={key} day={day} dimmed={mode === "month" && !isSameMonth(day, cursor)}>
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <time dateTime={key} className={cn("rounded px-1 text-xs", isToday(day) && "bg-cu-purple text-white")}>
                        {format(day, mode === "month" ? "EEE d" : "EEE, MMM d")}
                      </time>
                      {canSchedule && createListId && <button className="rounded p-0.5 hover:bg-cu-hover" aria-label={`Add task on ${key}`} onClick={() => begin(key)}><Plus className="h-4 w-4" /></button>}
                    </div>
                    <div className="space-y-1">
                      {(expanded ? untimed : untimed.slice(0, 4)).map(renderTask)}
                      {rows.length > 4 && mode === "month" && <button className="text-xs text-cu-purple hover:underline" aria-expanded={expanded}
                        onClick={() => setExpandedDay(expanded ? "" : key)}>{expanded ? "Show fewer" : `+${rows.length - 4} more`}</button>}
                    </div>
                    {timed && <div className="mt-2 border-t border-cu-border">
                      {hours.map((hour) => <HourSlot key={hour} date={key} hour={hour}
                        onCreate={canSchedule && createListId ? () => begin(key, hour) : undefined}>
                        {byHour.get(hour)?.map(renderTask)}
                      </HourSlot>)}
                    </div>}
                  </DayCell>
                );
              })}
            </div>
          </div>
          {showQueue && <aside aria-label="Scheduling queue" className="max-h-full w-full overflow-auto border-cu-border p-3 sm:w-56 sm:border-l">
            <h3 className="mb-2 text-sm font-semibold">Unscheduled ({unscheduled.length})</h3>
            {unscheduled.map((task) => <DraggableTask key={task.id} task={task} canSchedule={canSchedule} onOpen={() => onOpenTask(task.id, task.listId)} />)}
            <h3 className="mb-2 mt-4 text-sm font-semibold">Overdue ({overdue.length})</h3>
            {overdue.map((task) => <DraggableTask key={task.id} task={task} day={keyOf(new Date(task.dueDate!))} queue canSchedule={canSchedule} onOpen={() => onOpenTask(task.id, task.listId)} />)}
          </aside>}
        </div>
      </DndContext>
    </section>
  );
}

function DayCell({ day, dimmed, children }: { day: Date; dimmed: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: keyOf(day), data: { date: keyOf(day) } });
  return <div ref={setNodeRef} data-calendar-date={keyOf(day)}
    className={cn("min-h-28 border-b border-r border-cu-border p-2", dimmed && "bg-cu-sidebar/40", isOver && "bg-cu-purple-light ring-1 ring-inset ring-cu-purple")}>
    {children}
  </div>;
}

function HourSlot({ date, hour, onCreate, children }: {
  date: string; hour: number; onCreate?: () => void; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${date}T${hour}`, data: { date, hour } });
  const label = `${String(hour).padStart(2, "0")}:00`;
  return <div ref={setNodeRef} className={cn("min-h-10 border-b border-cu-border/60 py-1", isOver && "bg-cu-purple-light")}>
    {onCreate ? <button aria-label={`Add task on ${date} at ${label}`} onClick={onCreate} className="w-full text-left text-[11px] text-cu-text-secondary hover:text-cu-purple">{label}</button>
      : <span className="block text-[11px] text-cu-text-secondary">{label}</span>}
    {children}
  </div>;
}

function DraggableTask({ task, day, queue, canSchedule, showTime, onOpen }: {
  task: CalendarTask; day?: string; queue?: boolean; canSchedule: boolean; showTime?: boolean; onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${task.id}:${queue ? "queue" : day ?? "unscheduled"}`, data: { task, day }, disabled: !canSchedule,
  });
  const timing = day && dateOnDay(task, day);
  return <button ref={setNodeRef} {...listeners} {...attributes} onClick={onOpen}
    className={cn("relative flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-1 text-left text-xs", canSchedule && "touch-none cursor-grab", isDragging && "z-30 opacity-50")}
    style={{ backgroundColor: `${task.status.color}1f`, transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}>
    <StatusCircle status={task.status} size={10} />
    {showTime && timing && <span className="shrink-0 text-cu-text-secondary">{format(new Date(timing), "HH:mm")}</span>}
    <span className="truncate">{task.name}</span>
  </button>;
}
